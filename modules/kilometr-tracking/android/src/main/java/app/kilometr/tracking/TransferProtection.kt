package app.kilometr.tracking

import android.content.Context
import android.location.Location
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.util.concurrent.Executors
import kotlin.math.*

internal class TransferProtection(
  private val context: Context,
  val tripId: String,
  val path: String,
  private val onState: (JSONObject, Boolean) -> Unit,
) {
  private val worker = Executors.newSingleThreadExecutor()
  @Volatile private var closed = false
  private var network: TransferNetwork? = null
  private var connection: JSONObject? = null
  private var rides = emptyList<TransferRide>()
  private var rideIndex = 0
  private var estimator = TransferEstimator()
  private var nextEstimator = TransferEstimator()
  private var decision = TransferDecision()
  private var lastEstimate: RideEstimate? = null
  private var lastFix: TransferFix? = null
  private var lastLivePoll = 0L
  private var lastRoute = 0L
  private var lastPreparation = 0L
  private var prepared: List<TransferCandidate> = emptyList()
  private var preparedDelay = 0
  private var revision = 0
  private var lastRiskAlert = ""
  private var state = JSONObject()
  private val statusFile = File(File(path.removePrefix("file://")).parentFile, "state.json")

  init {
    worker.execute {
      try {
        val root = JSONObject(File(path.removePrefix("file://")).readText())
        if (root.getString("tripId") != tripId || closed) return@execute
        network = TransferNetwork(root)
        val saved = if (statusFile.exists()) JSONObject(statusFile.readText()) else null
        connection = saved?.optJSONObject("connection") ?: root.getJSONObject("connection")
        revision = saved?.optInt("revision") ?: 0
        lastRiskAlert = saved?.optString("alertKey") ?: ""
        rides = network!!.rides(connection!!)
        require(rides.size >= 2)
        val active = saved?.optInt("activeLegIndex", -1) ?: root.optInt("activeLegIndex", -1)
        rideIndex = rides.indexOfFirst { it.legIndex >= active }.coerceAtLeast(0)
        publish("waiting", System.currentTimeMillis())
      } catch (_: Exception) {
        publish("unavailable", System.currentTimeMillis(), "routing")
      }
    }
  }

  fun observe(location: Location) {
    val age = (android.os.SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000
    val now = System.currentTimeMillis()
    val fix = TransferFix(location.latitude, location.longitude,
      if (location.hasAccuracy()) location.accuracy.toDouble() else Double.POSITIVE_INFINITY,
      now - age, if (location.hasSpeed()) location.speed.toDouble() else null,
      if (location.hasBearing()) location.bearing.toDouble() else null)
    submit { update(fix, now) }
  }

  fun tick(nowMs: Long) = submit {
    val net = network ?: return@submit
    if (nowMs > net.root.getLong("validUntilMs")) {
      publish("unavailable", nowMs, "expired")
      return@submit
    }
    if (isComplete()) return@submit
    val ride = rides.getOrNull(rideIndex) ?: return@submit
    if (nowMs - lastLivePoll >= 45_000) {
      lastLivePoll = nowMs
      refreshLive(net, nowMs)
      if (closed) return@submit
    }
    val liveDelay = net.freshDelay(ride.tripId, nowMs)
    if (lastEstimate == null || nowMs - (lastFix?.atMs ?: 0) > 45_000) {
      if (liveDelay != null) {
        evaluate(net, ride, RideEstimate(max(ride.board.toDouble(), lastEstimate?.position ?: 0.0), liveDelay, nowMs), "live", nowMs)
        return@submit
      }
      state.remove("alternative")
      state.remove("alternatives")
      val first = ride.stops[ride.board].departMs
      publish(if (nowMs < first + 300_000) "waiting" else "unavailable", nowMs, if (nowMs < first + 300_000) null else "location")
    }
  }

  private fun isComplete() = state.optString("status") == "complete"

  private fun submit(action: () -> Unit) {
    if (closed) return
    try {
      worker.execute {
        if (!closed) try { action() } catch (_: Exception) {
          publish("unavailable", System.currentTimeMillis(), "routing")
        }
      }
    } catch (_: java.util.concurrent.RejectedExecutionException) { }
  }

  private fun update(fix: TransferFix, now: Long) {
    val net = network ?: return
    if (now > net.root.getLong("validUntilMs")) {
      publish("unavailable", now, "expired")
      return
    }
    val ride = rides.getOrNull(rideIndex) ?: return publish("complete", now)
    val next = rides.getOrNull(rideIndex + 1)
    val estimate = estimator.observe(ride.stops, ride.board, fix, now)
    val previousEstimate = lastEstimate
    if (next != null && previousEstimate != null && previousEstimate.position >= ride.alight - 0.2 &&
      now >= next.stops[next.board].departMs - 60_000) {
      val boarded = nextEstimator.observe(next.stops, next.board, fix, now)
      if (boarded != null) {
        rideIndex++
        estimator = nextEstimator
        nextEstimator = TransferEstimator()
        decision = TransferDecision()
        lastEstimate = boarded
        lastFix = fix
        state.remove("alternative")
        state.remove("alternatives")
        state.put("arrivalAtMs", next.stops[next.alight].arriveMs + boarded.delaySec * 1000L)
        publish("waiting", now)
        return
      }
    }
    if (estimate == null) {
      if (isComplete()) return
      val liveDelay = net.freshDelay(ride.tripId, now)
      if (liveDelay != null) {
        evaluate(net, ride, RideEstimate(max(ride.board.toDouble(), lastEstimate?.position ?: 0.0), liveDelay, now), "live", now)
        return
      }
      val transferStop = ride.stops[ride.alight]
      val nearTransfer = TransferEstimator.distanceMeters(fix.lat, fix.lon, transferStop.lat, transferStop.lon) <= 130.0 &&
        now >= transferStop.arriveMs - 90_000
      if (nearTransfer && next != null && now <= next.stops[next.board].departMs + 300_000) {
        publish("safe", now)
        return
      }
      if (lastEstimate == null && now < ride.stops[ride.board].departMs + 300_000) publish("waiting", now)
      else if (lastEstimate == null || now - lastEstimate!!.atMs > 45_000) publish("unavailable", now, "offRoute")
      return
    }
    lastEstimate = estimate
    lastFix = fix
    net.delays[ride.tripId] = estimate.delaySec to now
    evaluate(net, ride, estimate, "gps", now)
  }

  private fun evaluate(net: TransferNetwork, ride: TransferRide, estimate: RideEstimate, delaySource: String, now: Long) {
    val next = rides.getOrNull(rideIndex + 1)
    val oldAlternative = state.optJSONObject("alternative")
    if (oldAlternative != null && now >= oldAlternative.optLong("validUntil")) {
      state.remove("alternative")
      state.remove("alternatives")
    }
    state.put("arrivalAtMs", ride.stops[ride.alight].arriveMs + estimate.delaySec * 1000L)
      .put("delaySec", estimate.delaySec)
      .put("delaySource", delaySource)
    if (next == null) {
      state.remove("alternative")
      state.remove("alternatives")
      publish("complete", now)
      return
    }
    if (now - lastLivePoll >= 45_000) {
      lastLivePoll = now
      refreshLive(net, now)
      if (closed) return
    }
    val current = connection!!.getJSONArray("legs").getJSONObject(ride.legIndex)
    val target = connection!!.getJSONArray("legs").getJSONObject(next.legIndex)
    val walkSpeed = net.root.getJSONObject("options").getDouble("walkSpeedMps")
    var transferWalkM = 0
    val transferWalk = (ride.legIndex + 1 until next.legIndex).sumOf { i ->
      val leg = connection!!.getJSONArray("legs").getJSONObject(i)
      val m = leg.optDouble("walkM", 0.0)
      transferWalkM += m.roundToInt()
      max(0, (m * 1.15 / walkSpeed).roundToInt())
    }
    val arrivalMs = ride.stops[ride.alight].arriveMs + estimate.delaySec * 1000L
    val nextDelay = net.freshDelay(next.tripId, now)
    val departureMs = next.stops[next.board].departMs + (nextDelay ?: 0) * 1000L
    val physicalSlack = ((departureMs - arrivalMs) / 1000).toInt() - transferWalk
    val opts = net.root.getJSONObject("options")
    val nextIsTrain = target.optString("mode") == "train" || target.optString("tripId").startsWith("pl:")
    val buffer = max(60, if (nextIsTrain) opts.getInt("trainMinTransferSec") else opts.getInt("minTransferSec"))
    val passedAlight = delaySource == "gps" && estimate.position > ride.alight + 0.3
    val assessment = decision.assess(if (passedAlight) -120 else physicalSlack, buffer, now)
    if (assessment == "safe") {
      state.remove("alternative")
      state.remove("alternatives")
    }
    state.put("activeLegIndex", ride.legIndex).put("delaySec", estimate.delaySec)
      .put("slackSec", physicalSlack).put("walkSec", transferWalk).put("walkM", transferWalkM)
      .put("bufferSec", buffer)
      .put("nextLine", target.optString("line")).put("nextMode", target.optString("mode"))
      .put("currentLine", current.optString("line")).put("currentMode", current.optString("mode"))
      .put("transferStop", current.optString("toStop"))
      .put("departureAtMs", departureMs).put("arrivalAtMs", arrivalMs)
      .put("departureSource", if (nextDelay != null) "live" else "schedule")

    if (nextIsTrain && assessment == "missed") {
      state.remove("alternative")
      state.remove("alternatives")
      publish("conductor", now, alert = lastRiskAlert != "$revision:${ride.legIndex}:conductor")
      return
    }

    if (assessment == "missed" && now - lastRoute >= 45_000) {
      lastRoute = now
      publish("rerouting", now)
      val cached = prepared.takeIf { list ->
        list.isNotEmpty() && now - lastPreparation < 30_000 && abs(estimate.delaySec - preparedDelay) < 30
      }
      val candidates = cached ?: net.alternativesList(connection!!, ride, estimate, now)
      prepared = emptyList()
      if (closed) return
      val built = buildAlternativeJson(net, ride, estimate, candidates, now)
      if (built.length() > 0) {
        state.put("alternative", built.getJSONObject(0))
        state.put("alternatives", built)
        publish("alternative", now, alert = lastRiskAlert != "$revision:${ride.legIndex}:alternative")
      } else {
        publish("noAlternative", now, alert = lastRiskAlert != "$revision:${ride.legIndex}:none")
      }
    } else {
      if (assessment == "risk" && !nextIsTrain && now - lastPreparation >= 45_000) {
        lastPreparation = now
        preparedDelay = estimate.delaySec
        prepared = net.alternativesList(connection!!, ride, estimate, now)
      }
      val status = if (state.has("alternative")) "alternative" else if (assessment == "missed") "noAlternative" else assessment
      val key = "$revision:${ride.legIndex}:risk"
      publish(status, now, alert = status == "risk" && lastRiskAlert != key)
    }
  }

  private fun buildAlternativeJson(
    net: TransferNetwork,
    ride: TransferRide,
    estimate: RideEstimate,
    candidates: List<TransferCandidate>,
    now: Long,
  ): JSONArray {
    val array = JSONArray()
    val origTimeline = net.root.optJSONArray("timeline")
    val origArrivalMs = if (origTimeline != null && origTimeline.length() > 0) {
      origTimeline.getJSONObject(origTimeline.length() - 1).optLong("arriveMs", 0L)
    } else 0L
    for (candidate in candidates) {
      val candidateRides = net.rides(candidate.connection)
      val newNext = candidateRides.firstOrNull { it.legIndex > ride.legIndex } ?: continue
      val decisionAt = ride.stops[min(ride.alight, candidate.alight)].arriveMs + estimate.delaySec * 1000L - 60_000
      if (decisionAt <= now) continue
      val legs = candidate.connection.getJSONArray("legs")
      val nextLeg = legs.getJSONObject(newNext.legIndex)
      val depMs = newNext.stops[newNext.board].departMs + (net.freshDelay(newNext.tripId, now) ?: 0) * 1000L
      val alightMs = ride.stops[candidate.alight].arriveMs + estimate.delaySec * 1000L
      val obj = JSONObject()
        .put("id", "$revision:${ride.legIndex}:${newNext.tripId}:${candidate.alight}")
        .put("connection", candidate.connection).put("activeLegIndex", ride.legIndex)
        .put("nextLine", nextLeg.optString("line")).put("nextMode", nextLeg.optString("mode"))
        .put("transferStop", ride.stops[candidate.alight].name)
        .put("departureAtMs", depMs)
        .put("arrivalAtMs", candidate.arrivalAtMs).put("validUntil", decisionAt)
        .put("kind", if (candidate.alight == ride.alight) "sameStop" else "stayOn")
        .put("source", "raptor")
        .put("slackSec", ((depMs - alightMs) / 1000).toInt())
      if (origArrivalMs > 0L) {
        obj.put("deltaArrivalMin", ((candidate.arrivalAtMs - origArrivalMs) / 60_000.0).roundToInt())
      }
      array.put(obj)
    }
    return array
  }

  private fun refreshLive(net: TransferNetwork, now: Long) {
    val rawUrl = net.root.optString("liveUrl", "")
    if (rawUrl.isBlank()) return
    var request: HttpURLConnection? = null
    try {
      val url = URI(rawUrl).toURL()
      if (url.protocol != "https" || url.host != "zbiorkom.live") return
      request = url.openConnection() as HttpURLConnection
      request.connectTimeout = 3000
      request.readTimeout = 3000
      if (request.responseCode == 200) request.inputStream.bufferedReader().use {
        val rows = JSONObject(it.readText()).optJSONArray("positions") ?: return
        net.matchLive(rows, now)
      }
    } catch (_: Exception) { } finally { request?.disconnect() }
  }

  private fun publish(status: String, now: Long, reason: String? = null, alert: Boolean = false) {
    if (closed) return
    val index = rides.getOrNull(rideIndex)?.legIndex ?: 0
    state.put("tripId", tripId).put("status", status).put("updatedAt", now)
      .put("revision", revision).put("activeLegIndex", index)
      .put("connection", connection)
      .put("scope", "background")
    if (reason == null) state.remove("reason") else state.put("reason", reason)
    if (alert) {
      val tag = when (status) {
        "noAlternative" -> "none"
        "alternative" -> "alternative"
        "conductor" -> "conductor"
        else -> "risk"
      }
      lastRiskAlert = "$revision:$index:$tag"
    }
    state.put("alertKey", lastRiskAlert)
    val copy = network?.root?.optJSONObject("copy")
    state.put("baseMs", network?.baseMs ?: 0)
      .put("validUntilMs", network?.root?.optLong("validUntilMs") ?: now)
      .put("channelName", copy?.optString("channelName") ?: "")
    val titleKey = when (status) {
      "changed" -> "changedTitle"
      "alternative" -> "alternativeTitle"
      "conductor" -> "conductorTitle"
      "risk", "noAlternative", "rerouting" -> "riskTitle"
      "unavailable" -> "unavailable"
      else -> "title"
    }
    fun text(key: String): String = (copy?.optString(key) ?: "")
      .replace("{line}", state.optString("currentLine"))
      .replace("{nextLine}", state.optString("nextLine"))
      .replace("{stop}", state.optString("transferStop"))
    state.put("notificationTitle", text(titleKey))
      .put("notificationText", text(when (status) {
        "changed" -> "changedBody"
        "alternative" -> "alternativeBody"
        "conductor" -> "conductorBody"
        "noAlternative" -> "noAlternative"
        "unavailable" -> "unavailableBody"
        "waiting" -> "waiting"
        "rerouting" -> "rerouting"
        "risk" -> "riskBody"
        else -> "safeBody"
      }))
    try {
      val temporary = File(statusFile.parentFile, "state.tmp")
      temporary.writeText(state.toString())
      if (!closed) temporary.renameTo(statusFile) else temporary.delete()
    } catch (_: Exception) { }
    if (!closed) onState(JSONObject(state.toString()), alert)
  }

  fun close() {
    closed = true
    worker.shutdownNow()
  }

  companion object {
    private const val PREFS = "kilometr.transfer-protection"
    fun configure(context: Context, tripId: String, path: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString("tripId", tripId).putString("path", path).apply()
    }
    fun pathFor(context: Context, tripId: String): String? {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return if (prefs.getString("tripId", null) == tripId) prefs.getString("path", null) else null
    }
    fun readState(context: Context): String? {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val path = prefs.getString("path", null) ?: return null
      return try { File(File(path.removePrefix("file://")).parentFile, "state.json").readText() } catch (_: Exception) { null }
    }
    fun clear(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }
  }
}
