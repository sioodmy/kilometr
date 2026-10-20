package app.kilometr.tracking

import android.content.Context
import android.location.Location
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
  private var prepared: TransferCandidate? = null
  private var preparedDelay = 0
  private var revision = 0
  private var changedAt = 0L
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
        changedAt = saved?.optLong("changedAt") ?: 0L
        lastRiskAlert = saved?.optString("alertKey") ?: ""
        rides = network!!.rides(connection!!)
        val active = saved?.optInt("activeLegIndex", -1) ?: -1
        rideIndex = rides.indexOfFirst { it.legIndex == active }.coerceAtLeast(0)
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
    if (lastEstimate == null || nowMs - (lastFix?.atMs ?: 0) > 30_000) {
      val first = net.root.getJSONArray("timeline").getJSONObject(0).getLong("departMs")
      publish(if (nowMs < first) "waiting" else "unavailable", nowMs, "location")
    }
  }

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
        changedAt = 0
        publish("waiting", now)
        return
      }
    }
    if (estimate == null) {
      if (lastEstimate == null && now < ride.stops[ride.board].departMs + 300_000) publish("waiting", now)
      else if (lastEstimate == null || now - lastEstimate!!.atMs > 30_000) publish("unavailable", now, "offRoute")
      return
    }
    lastEstimate = estimate
    lastFix = fix
    net.delays[ride.tripId] = estimate.delaySec to now
    if (next == null) {
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
    val transferWalk = (ride.legIndex + 1 until next.legIndex).sumOf { i ->
      val leg = connection!!.getJSONArray("legs").getJSONObject(i)
      max(0, (leg.optDouble("walkM", 0.0) * 1.15 / net.root.getJSONObject("options").getDouble("walkSpeedMps")).roundToInt())
    }
    val arrivalMs = ride.stops[ride.alight].arriveMs + estimate.delaySec * 1000L
    val nextDelay = net.freshDelay(next.tripId, now)
    val departureMs = next.stops[next.board].departMs + (nextDelay ?: 0) * 1000L
    val physicalSlack = ((departureMs - arrivalMs) / 1000).toInt() - transferWalk
    val opts = net.root.getJSONObject("options")
    val buffer = max(60, if (target.optString("mode") == "train") opts.getInt("trainMinTransferSec") else opts.getInt("minTransferSec"))
    val assessment = decision.assess(physicalSlack, buffer, now)
    state.put("activeLegIndex", ride.legIndex).put("delaySec", estimate.delaySec)
      .put("slackSec", physicalSlack - buffer).put("nextLine", target.optString("line"))
      .put("currentLine", current.optString("line")).put("transferStop", current.optString("toStop"))
      .put("departureAtMs", departureMs).put("arrivalAtMs", arrivalMs)
      .put("departureSource", if (nextDelay != null) "live" else "schedule")
    val passedAlight = estimate.position > ride.alight + 0.3
    if ((assessment == "missed" || passedAlight) && now - lastRoute >= 60_000) {
      lastRoute = now
      publish("rerouting", now)
      val cached = prepared?.takeIf { candidate ->
        now - lastPreparation < 30_000 && abs(estimate.delaySec - preparedDelay) < 30 &&
          ride.stops[candidate.alight].arriveMs + estimate.delaySec * 1000L > now + 60_000
      }
      val candidate = cached ?: net.alternatives(connection!!, ride, estimate, now)
      prepared = null
      if (closed) return
      if (candidate != null) {
        connection = candidate.connection
        revision++
        changedAt = now
        rides = net.rides(connection!!)
        rideIndex = rides.indexOfFirst { it.legIndex == ride.legIndex }.coerceAtLeast(0)
        decision = TransferDecision()
        state.put("transferStop", ride.stops[candidate.alight].name)
        val newNext = rides.getOrNull(rideIndex + 1)
        state.put("nextLine", newNext?.let { connection!!.getJSONArray("legs").getJSONObject(it.legIndex).optString("line") } ?: "")
          .put("arrivalAtMs", ride.stops[candidate.alight].arriveMs + estimate.delaySec * 1000L)
        if (newNext != null) state.put("departureAtMs", newNext.stops[newNext.board].departMs +
          (net.freshDelay(newNext.tripId, now) ?: 0) * 1000L)
        publish("changed", now, alert = true)
      } else publish("noAlternative", now, alert = lastRiskAlert != "$revision:${ride.legIndex}:none")
    } else {
      if (assessment == "risk" && now - lastPreparation >= 60_000) {
        lastPreparation = now
        preparedDelay = estimate.delaySec
        prepared = net.alternatives(connection!!, ride, estimate, now)
      }
      val status = if (assessment == "missed") "noAlternative" else if (now - changedAt < 120_000) "changed" else assessment
      val key = "$revision:${ride.legIndex}:risk"
      publish(status, now, alert = status == "risk" && lastRiskAlert != key)
    }
  }

  private fun refreshLive(net: TransferNetwork, now: Long) {
    var request: HttpURLConnection? = null
    try {
      val url = URI(net.root.getString("liveUrl")).toURL()
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
      .put("revision", revision).put("activeLegIndex", index).put("changedAt", changedAt)
      .put("connection", connection)
    if (reason == null) state.remove("reason") else state.put("reason", reason)
    if (alert) lastRiskAlert = "$revision:$index:${if (status == "noAlternative") "none" else "risk"}"
    state.put("alertKey", lastRiskAlert)
    val copy = network?.root?.optJSONObject("copy")
    state.put("baseMs", network?.baseMs ?: 0)
      .put("validUntilMs", network?.root?.optLong("validUntilMs") ?: now)
      .put("channelName", copy?.optString("channelName") ?: "")
    val titleKey = when (status) {
      "changed" -> "changedTitle"
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
    if (!closed) onState(JSONObject(state.toString()), alert && network?.root?.optBoolean("alertsEnabled", true) != false)
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
