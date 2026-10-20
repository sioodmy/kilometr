package app.kilometr.tracking

import app.kilometr.raptor.KilometrRaptorBridge
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*

internal data class TransferRide(
  val legIndex: Int, val tripId: String, val board: Int, var alight: Int,
  val stops: List<TransferStop>,
)

internal data class TransferCandidate(val connection: JSONObject, val cost: Double, val alight: Int)

internal class TransferNetwork(val root: JSONObject) {
  private val bytes = File(root.getString("networkPath").removePrefix("file://")).readBytes()
  private val data = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
  private val stops = root.getJSONArray("stops")
  private val patterns = root.getJSONArray("patterns")
  private val options = root.getJSONObject("options")
  private val destinations = root.getJSONArray("destinations")
  val baseMs = root.getLong("baseMs")
  private val locations = HashMap<String, Pair<Int, Int>>()
  private data class Pattern(val n: Int, val trips: Int, val stops: Int, val dep: Int, val arr: Int)
  private val packedPatterns = ArrayList<Pattern>()
  private val footCount: Int
  private val footStart: Int
  private val footTo: Int
  private val footDistance: Int
  private val footFixed: Int
  val delays = HashMap<String, Pair<Int, Long>>()

  init {
    require(data.int == 0x52415031)
    data.int
    footCount = data.int
    val edges = data.int
    val count = data.int
    val stopPatterns = data.int
    val stopEdges = data.int
    footStart = data.position()
    footTo = footStart + (footCount + 1) * 4
    footDistance = footTo + edges * 4
    footFixed = footDistance + edges * 4
    data.position(footFixed + edges * 4 + (stopPatterns + 1) * 4 + stopEdges * 8)
    require(count == patterns.length())
    repeat(count) { p ->
      data.int
      val n = data.int
      val trips = data.int
      require(n >= 2 && trips > 0)
      val start = data.position()
      val dep = start + n * 4
      val arr = dep + n * trips * 4
      packedPatterns += Pattern(n, trips, start, dep, arr)
      data.position(arr + n * trips * 4)
      val ids = patterns.getJSONObject(p).getJSONArray("trips")
      repeat(ids.length()) { j -> locations[ids.getString(j)] = p to j }
    }
    val initial = root.optJSONArray("delays") ?: JSONArray()
    repeat(initial.length()) { i ->
      val d = initial.getJSONObject(i)
      delays[d.getString("tripId")] = d.getInt("delaySec") to d.getLong("at")
    }
  }

  private fun word(offset: Int) = data.getInt(offset)
  private fun stopIndex(p: Int, pos: Int) = word(packedPatterns[p].stops + pos * 4)
  private fun time(p: Int, j: Int, pos: Int, departure: Boolean): Int {
    val pattern = packedPatterns[p]
    return word((if (departure) pattern.dep else pattern.arr) + (j * pattern.n + pos) * 4)
  }

  fun tripStops(tripId: String): List<TransferStop> {
    val (p, j) = locations[tripId] ?: return emptyList()
    return (0 until packedPatterns[p].n).map { i ->
      val idx = stopIndex(p, i)
      val stop = stops.getJSONObject(idx)
      TransferStop(stop.getString("id"), stop.getString("name"), stop.optDouble("lat"),
        stop.optDouble("lon"), baseMs + time(p, j, i, false) * 1000L,
        baseMs + time(p, j, i, true) * 1000L, idx)
    }
  }

  fun rides(connection: JSONObject): List<TransferRide> {
    val legs = connection.getJSONArray("legs")
    return (0 until legs.length()).mapNotNull { i ->
      val leg = legs.getJSONObject(i)
      if (leg.optString("mode") == "walk") return@mapNotNull null
      val tripId = leg.optString("tripId")
      val route = tripStops(tripId)
      val board = route.indexOfFirst { it.id == leg.optString("fromStopId") }
      val alight = route.indexOfFirst { it.id == leg.optString("toStopId") }
      if (board < 0 || alight <= board) null else TransferRide(i, tripId, board, alight, route)
    }
  }

  fun freshDelay(tripId: String, nowMs: Long): Int? = delays[tripId]?.takeIf {
    nowMs - it.second in 0..120_000
  }?.first

  fun matchLive(rows: JSONArray, nowMs: Long) {
    repeat(rows.length()) { i ->
      val row = rows.optJSONObject(i) ?: return@repeat
      val at = row.optLong("timestamp")
      if (nowMs - at !in 0..120_000 || !row.has("delay") || row.isNull("delay")) return@repeat
      val upcoming = row.optJSONArray("upcomingStops") ?: return@repeat
      if (upcoming.length() == 0) return@repeat
      val match = ArrayList<String>()
      for (p in packedPatterns.indices) {
        val meta = patterns.getJSONObject(p)
        if (meta.optString("line") != row.optString("routeName")) continue
        val pattern = packedPatterns[p]
        for (j in 0 until pattern.trips) {
          var confirmed = 0
          for (u in 0 until min(2, upcoming.length())) {
            val next = upcoming.getJSONObject(u)
            val scheduled = next.optLong("scheduledDeparture", next.optLong("scheduledArrival"))
            for (k in 0 until pattern.n) {
              val name = stops.getJSONObject(stopIndex(p, k)).optString("name")
              if (name.equals(next.optString("name"), ignoreCase = true) &&
                abs(baseMs + time(p, j, k, true) * 1000L - scheduled) <= 30_000) {
                confirmed++
                break
              }
            }
          }
          if (confirmed == min(2, upcoming.length())) match += meta.getJSONArray("trips").getString(j)
        }
      }
      if (match.size == 1) {
        val delay = (row.getDouble("delay") / 1000).roundToInt()
        if (abs(delay) <= 3600) delays[match.single()] = delay to at
      }
    }
  }

  private fun origins(stop: TransferStop, buffer: Int): List<IntArray> {
    val out = mutableListOf(intArrayOf(stop.networkIndex, buffer, 0))
    val maxWalk = min(800, options.getInt("maxWalkM"))
    val speed = options.getDouble("walkSpeedMps")
    if (stop.networkIndex in 0 until footCount) {
      val a = word(footStart + stop.networkIndex * 4)
      val b = word(footStart + (stop.networkIndex + 1) * 4)
      for (edge in a until b) {
        val meters = word(footDistance + edge * 4)
        if (meters > maxWalk) continue
        val fixed = word(footFixed + edge * 4)
        val walk = if (fixed > 0) fixed else max(45, (meters * 1.15 / speed).roundToInt())
        out += intArrayOf(word(footTo + edge * 4), buffer + walk, meters)
      }
    }
    return out
  }

  fun alternatives(connection: JSONObject, ride: TransferRide, estimate: RideEstimate, nowMs: Long): TransferCandidate? {
    if (!KilometrRaptorBridge.isLoaded) return null
    if (!KilometrRaptorBridge.nativeHasNetwork(NET_ID)) {
      if (!KilometrRaptorBridge.nativeLoadNetwork(NET_ID, bytes)) return null
    }
    val used = (0 until ride.legIndex).count {
      connection.getJSONArray("legs").getJSONObject(it).optString("mode") != "walk"
    }
    val remaining = options.getInt("maxTransfers") - used - 1
    if (remaining < 0) return null
    val buffer = max(60, options.getInt("minTransferSec"))
    val first = max(ride.board + 1, floor(estimate.position).toInt() + 1)
    val candidates = ((first..min(ride.stops.lastIndex, first + 5)).toList() + ride.alight)
      .distinct().filter { it >= first && it <= ride.stops.lastIndex }
    var best: TransferCandidate? = null
    for (alight in candidates) {
      val stop = ride.stops[alight]
      val arrival = stop.arriveMs + estimate.delaySec * 1000L
      if (stop.networkIndex < 0 || arrival < nowMs + 60_000) continue
      val origin = origins(stop, buffer)
      val activeDelays = delays.mapNotNull { (id, value) ->
        val loc = locations[id] ?: return@mapNotNull null
        if (nowMs - value.second !in 0..120_000) null else intArrayOf(loc.first, loc.second, value.first)
      }
      val query = ByteBuffer.allocate((22 + origin.size * 3 + destinations.length() * 3 + activeDelays.size * 3) * 4)
        .order(ByteOrder.LITTLE_ENDIAN)
      query.putInt(0x52515231).putInt(NET_ID).putInt(((arrival - baseMs) / 1000).toInt())
        .putInt(1800).putInt(remaining.coerceAtMost(3)).putInt(buffer)
        .putInt(max(buffer, options.getInt("trainMinTransferSec")))
      val allowed = options.getJSONObject("allowedModes")
      query.putInt(if (allowed.optBoolean("train", true)) 1 else 0)
        .putInt(if (allowed.optBoolean("cable", true)) 1 else 0).putInt(0)
        .putDouble(options.getDouble("walkSpeedMps")).putInt(min(800, options.getInt("maxWalkM")))
        .putDouble(options.getJSONObject("cost").getDouble("walkReluctance"))
        .putInt(options.getJSONObject("cost").getInt("transferPenaltySec"))
        .putInt(0x3fffffff).putInt(1).putInt(((nowMs - baseMs) / 1000).toInt())
        .putInt(origin.size).putInt(destinations.length()).putInt(activeDelays.size)
      for (o in origin) for (value in o) query.putInt(value)
      repeat(destinations.length()) { d ->
        val dest = destinations.getJSONObject(d)
        query.putInt(dest.getInt("stopIndex")).putInt(dest.getInt("walkSec")).putInt(dest.getInt("walkM"))
      }
      for (d in activeDelays) for (value in d) query.putInt(value)
      val result = KilometrRaptorBridge.nativeRunQuery(query.array()) ?: continue
      for (candidate in decode(result, connection, ride, alight, estimate, arrival, nowMs)) {
        if (best == null || candidate.cost < best.cost) best = candidate
      }
    }
    return best
  }

  private fun leg(mode: String, from: Int, to: Int, departure: Int, arrival: Int): JSONObject {
    val a = stops.getJSONObject(from)
    val b = stops.getJSONObject(to)
    return JSONObject().put("id", "transfer-$from-$to-$departure").put("mode", mode)
      .put("fromStop", a.getString("name")).put("toStop", b.getString("name"))
      .put("fromStopId", a.getString("id")).put("toStopId", b.getString("id"))
      .put("fromLat", a.optDouble("lat")).put("fromLon", a.optDouble("lon"))
      .put("toLat", b.optDouble("lat")).put("toLon", b.optDouble("lon"))
      .put("platformCode", a.optString("code")).put("departAt", clock(departure))
      .put("arriveAt", clock(arrival)).put("stopsCount", 0).put("live", false)
  }

  private fun decode(bytes: ByteArray, connection: JSONObject, ride: TransferRide, alight: Int,
    estimate: RideEstimate, arrivalMs: Long, nowMs: Long): List<TransferCandidate> {
    val result = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    if (result.remaining() < 4) return emptyList()
    val count = result.int
    if (count <= 0) return emptyList()
    val out = ArrayList<TransferCandidate>()
    repeat(count) {
      if (result.remaining() < 28) return out
      val destination = result.int
      val origin = result.int
      val accessSec = result.int
      val accessM = result.int
      val egressSec = result.int
      val egressM = result.int
      val n = result.int
      if (n <= 0 || result.remaining() < n * 32) return out
      val raw = (0 until n).map { IntArray(8) { result.int } }
      val legs = JSONArray()
      val original = connection.getJSONArray("legs")
      for (i in 0 until ride.legIndex) legs.put(JSONObject(original.getJSONObject(i).toString()))
      val current = JSONObject(original.getJSONObject(ride.legIndex).toString())
      val target = ride.stops[alight]
      current.put("toStop", target.name).put("toStopId", target.id)
        .put("toLat", target.lat).put("toLon", target.lon)
        .put("arriveAt", clock(((arrivalMs - baseMs) / 1000).toInt()))
        .put("stopsCount", alight - ride.board)
        .put("intermediateStops", stopJson(ride.stops.subList(ride.board, alight + 1)))
      legs.put(current)
      var previousStop = target.networkIndex
      var previousArrival = ((arrivalMs - baseMs) / 1000).toInt()
      var totalWalk = 0
      var valid = true
      for ((i, row) in raw.withIndex()) {
        val (p, j, board, end) = row.take(4)
        val meta = patterns.optJSONObject(p)
        val pattern = packedPatterns.getOrNull(p)
        if (meta == null || pattern == null || j !in 0 until pattern.trips ||
          board !in 0 until pattern.n || end !in board + 1 until pattern.n) { valid = false; break }
        val mode = meta.getString("mode")
        if (!options.getJSONObject("allowedModes").optBoolean(mode, true)) { valid = false; break }
        val from = stopIndex(p, board)
        val to = stopIndex(p, end)
        val walkSec = if (i == 0) accessSec else row[4]
        val walkM = if (i == 0) accessM else row[5]
        if (from != previousStop) {
          legs.put(leg("walk", previousStop, from, previousArrival, previousArrival + walkSec)
            .put("walkM", walkM))
          totalWalk += walkM
        }
        val tripId = meta.getJSONArray("trips").getString(j)
        if (tripId == ride.tripId || row[6] < previousArrival + walkSec) { valid = false; break }
        val next = leg(mode, from, to, row[6], row[7])
          .put("line", meta.getString("line")).put("tripId", tripId)
          .put("routeId", meta.getString("routeId"))
          .put("direction", meta.getJSONArray("directions").optString(j))
          .put("stopsCount", end - board)
          .put("live", freshDelay(tripId, nowMs) != null)
          .put("intermediateStops", stopJson(tripStops(tripId).subList(board, end + 1)))
        legs.put(next)
        previousStop = to
        previousArrival = row[7]
      }
      if (!valid) return@repeat
      if (egressM > 0) {
        val end = root.getJSONObject("destination")
        val walk = leg("walk", destination, destination, previousArrival, previousArrival + egressSec)
          .put("toStopId", "destination").put("toStop", end.getString("name"))
          .put("toLat", end.getDouble("lat")).put("toLon", end.getDouble("lon"))
          .put("walkM", egressM)
        legs.put(walk)
        totalWalk += egressM
      }
      val endSec = previousArrival + egressSec
      val firstDeparture = root.getJSONArray("timeline").getJSONObject(0).getLong("departMs")
      val changed = JSONObject(connection.toString()).put("legs", legs)
        .put("arriveAt", clock(endSec)).put("durationMin", ceil((baseMs + endSec * 1000L - firstDeparture) / 60_000.0).toInt())
        .put("transfers", (0 until legs.length()).count { legs.getJSONObject(it).getString("mode") != "walk" } - 1)
        .put("delayMin", (estimate.delaySec / 60.0).roundToInt()).put("live", true)
        .put("interchange", target.name)
      val cost = options.getJSONObject("cost")
      out += TransferCandidate(changed,
        endSec + totalWalk * 1.15 / options.getDouble("walkSpeedMps") * (cost.getDouble("walkReluctance") - 1) +
          n * cost.getInt("transferPenaltySec"), alight)
    }
    return out
  }

  private fun stopJson(route: List<TransferStop>) = JSONArray(route.mapIndexed { i, s ->
    JSONObject().put("stopId", s.id).put("name", s.name).put("lat", s.lat).put("lon", s.lon)
      .put("seq", i).put("arriveSec", (s.arriveMs - baseMs) / 1000).put("departSec", (s.departMs - baseMs) / 1000)
  })

  companion object {
    const val NET_ID = -74621
    fun clock(sec: Int): String {
      val normalized = ((sec % 86400) + 86400) % 86400
      return "%02d:%02d".format(java.util.Locale.ROOT, normalized / 3600, normalized / 60 % 60)
    }
  }
}
