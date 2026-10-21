package app.kilometr.tracking

import org.junit.Assert.*
import org.junit.Test

class TransferEstimatorTest {
  private val epoch = 1_800_000_000_000L
  private val stops = (0..5).map { i ->
    TransferStop("$i", "Stop $i", 51.0, 17.0 + i * 0.005,
      epoch + i * 60_000, epoch + i * 60_000, i)
  }
  private fun fix(position: Double, seconds: Int, delay: Int = 0, accuracy: Double = 8.0) =
    TransferFix(51.0, 17.0 + position * 0.005, accuracy, epoch + (seconds + delay) * 1000,
      speed = 6.0, heading = 90.0)

  @Test fun confirmsRideAndMeasuresPhoneDelay() {
    val estimator = TransferEstimator()
    val first = fix(0.2, 12, 180)
    assertNull(estimator.observe(stops, 0, first, first.atMs))
    val second = fix(0.4, 24, 180)
    val estimate = estimator.observe(stops, 0, second, second.atMs)!!
    assertEquals(180, estimate.delaySec)
    assertEquals(0.4, estimate.position, 0.001)
  }

  @Test fun walkingAndStationaryFixesDoNotConfirmBoarding() {
    val estimator = TransferEstimator()
    for (i in 0..5) {
      val point = fix(0.02 * i, i * 10).copy(speed = 0.7)
      assertNull(estimator.observe(stops, 0, point, point.atMs))
    }
  }

  @Test fun frequentLocationCallbacksStillConfirmBoarding() {
    val estimator = TransferEstimator()
    for (second in listOf(0, 5)) {
      val point = fix(0.1 + second / 60.0, 6 + second, 120)
      assertNull(estimator.observe(stops, 0, point, point.atMs))
    }
    val point = fix(0.1 + 10 / 60.0, 16, 120)
    assertEquals(120, estimator.observe(stops, 0, point, point.atMs)!!.delaySec)
  }

  @Test fun rejectsStaleCoarseAndWrongDirectionGps() {
    val estimator = TransferEstimator()
    val point = fix(0.2, 12)
    assertNull(estimator.observe(stops, 0, point, point.atMs + 21_000))
    assertNull(estimator.observe(stops, 0, point.copy(accuracy = 100.0), point.atMs))
    assertNull(estimator.observe(stops, 0, point.copy(heading = 270.0), point.atMs))
    assertNull(estimator.observe(stops, 0, point.copy(lat = 52.0), point.atMs))
    assertNull(estimator.observe(stops, 0, point.copy(atMs = point.atMs + 1000), point.atMs))
  }

  @Test fun stoppedTramAccumulatesDelayAfterBoarding() {
    val estimator = TransferEstimator()
    val a = fix(0.2, 12)
    val b = fix(0.4, 24)
    estimator.observe(stops, 0, a, a.atMs)
    assertNotNull(estimator.observe(stops, 0, b, b.atMs))
    var last: RideEstimate? = null
    for (i in 1..4) {
      val stationary = fix(0.4, 24 + i * 15).copy(speed = 0.0)
      last = estimator.observe(stops, 0, stationary, stationary.atMs)
    }
    assertTrue(last!!.delaySec >= 45)
  }

  @Test fun retainsServiceDayAcrossMidnight() {
    val estimator = TransferEstimator()
    val overnight = stops.map { it.copy(arriveMs = it.arriveMs + 86_400_000, departMs = it.departMs + 86_400_000) }
    val a = fix(0.2, 12, 240).let { it.copy(atMs = it.atMs + 86_400_000) }
    val b = fix(0.4, 24, 240).let { it.copy(atMs = it.atMs + 86_400_000) }
    estimator.observe(overnight, 0, a, a.atMs)
    assertEquals(240, estimator.observe(overnight, 0, b, b.atMs)!!.delaySec)
  }

  @Test fun delayOfConnectingTramCanSaveTheTransfer() {
    val decision = TransferDecision()
    val arrival = 600
    val walk = 60
    val scheduledDeparture = 630
    assertEquals("risk", decision.assess(scheduledDeparture - arrival - walk, 90, epoch))
    val connectingDelay = 300
    assertEquals("safe", decision.assess(scheduledDeparture + connectingDelay - arrival - walk, 90, epoch + 10_000))
  }

  @Test fun confirmsMissedTransferOverTimeAndResetsAfterSignalGap() {
    val decision = TransferDecision()
    assertEquals("risk", decision.assess(-120, 90, epoch))
    assertEquals("risk", decision.assess(-120, 90, epoch + 10_000))
    assertEquals("missed", decision.assess(-120, 90, epoch + 20_000))
    assertEquals("risk", decision.assess(-120, 90, epoch + 70_000))
    assertEquals("safe", decision.assess(240, 90, epoch + 80_000))
  }
}
