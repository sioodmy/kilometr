package app.kilometr.tracking

import kotlin.math.*

internal data class TransferStop(
  val id: String, val name: String, val lat: Double, val lon: Double,
  val arriveMs: Long, val departMs: Long, val networkIndex: Int = -1,
)

internal data class TransferFix(
  val lat: Double, val lon: Double, val accuracy: Double, val atMs: Long,
  val speed: Double? = null, val heading: Double? = null,
)

internal data class RideEstimate(val position: Double, val delaySec: Int, val atMs: Long)

internal class TransferEstimator {
  private var previous: Pair<TransferFix, Double>? = null
  private var established = false
  private var lastPosition = -1.0
  private val delays = ArrayDeque<Int>()

  fun observe(stops: List<TransferStop>, board: Int, fix: TransferFix, nowMs: Long): RideEstimate? {
    if (stops.size < 2 || board !in 0 until stops.lastIndex ||
      !fix.lat.isFinite() || !fix.lon.isFinite() || !fix.accuracy.isFinite() ||
      fix.accuracy !in 0.0..45.0 || nowMs - fix.atMs !in 0..20_000) return null

    data class Projection(val position: Double, val distance: Double, val expectedMs: Long)
    val candidates = ArrayList<Projection>()
    for (i in board until stops.lastIndex) {
      if (lastPosition >= 0 && i + 1 < lastPosition - 0.15) continue
      val a = stops[i]
      val b = stops[i + 1]
      val scale = cos(Math.toRadians(fix.lat))
      val x = (b.lon - a.lon) * scale * 111_195
      val y = (b.lat - a.lat) * 111_195
      val length = hypot(x, y)
      if (length < 10) continue
      val fx = (fix.lon - a.lon) * scale * 111_195
      val fy = (fix.lat - a.lat) * 111_195
      val fraction = ((fx * x + fy * y) / (length * length)).coerceIn(0.0, 1.0)
      val distance = hypot(fx - fraction * x, fy - fraction * y)
      if (distance > max(65.0, fix.accuracy * 2)) continue
      if (!established && fix.heading != null && (fix.speed ?: 0.0) >= 2.2) {
        val bearing = (Math.toDegrees(atan2(x, y)) + 360) % 360
        val diff = abs((fix.heading - bearing + 540) % 360 - 180)
        if (diff > 65) continue
      }
      val expected = a.departMs + ((b.arriveMs - a.departMs) * fraction).roundToLong()
      if (nowMs < expected - 180_000 || nowMs > expected + 3_600_000) continue
      candidates += Projection(i + fraction, distance, expected)
    }
    val best = candidates.minByOrNull { it.distance } ?: return null
    if (lastPosition >= 0 && best.position < lastPosition - 0.15) return null
    val old = previous
    if (!established) {
      if (old == null) { previous = fix to best.position; return null }
      val elapsed = fix.atMs - old.first.atMs
      if (elapsed < 8_000) return null
      val displacement = distanceMeters(old.first.lat, old.first.lon, fix.lat, fix.lon)
      if (elapsed !in 8_000..60_000 || best.position <= old.second ||
        displacement < 25 || displacement / (elapsed / 1000.0) < 2.0) {
        previous = fix to best.position
        return null
      }
      established = true
    } else if (old != null) {
      val elapsed = fix.atMs - old.first.atMs
      if (elapsed > 0 && distanceMeters(old.first.lat, old.first.lon, fix.lat, fix.lon) /
        (elapsed / 1000.0) > 50) return null
    }
    previous = fix to best.position
    lastPosition = max(lastPosition, best.position)
    val delay = ((fix.atMs - best.expectedMs) / 1000.0).roundToInt().coerceIn(-180, 3600)
    delays.addLast(delay)
    if (delays.size > 3) delays.removeFirst()
    return RideEstimate(lastPosition, delays.sorted()[delays.size / 2], fix.atMs)
  }

  companion object {
    fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
      val x = Math.toRadians(lon2 - lon1) * cos(Math.toRadians((lat1 + lat2) / 2))
      val y = Math.toRadians(lat2 - lat1)
      return hypot(x, y) * 6_371_000
    }
  }
}

internal class TransferDecision {
  private var missedSince = 0L
  private var lastAt = 0L
  private var status = "safe"

  fun assess(physicalSlackSec: Int, bufferSec: Int, nowMs: Long): String {
    if (physicalSlackSec >= bufferSec + 60) {
      missedSince = 0
      status = "safe"
    } else if (physicalSlackSec < -30) {
      if (missedSince == 0L || nowMs - lastAt > 30_000) missedSince = nowMs
      status = if (nowMs - missedSince >= 20_000) "missed" else "risk"
    } else {
      missedSince = 0
      if (physicalSlackSec < bufferSec) status = "risk"
    }
    lastAt = nowMs
    return status
  }
}
