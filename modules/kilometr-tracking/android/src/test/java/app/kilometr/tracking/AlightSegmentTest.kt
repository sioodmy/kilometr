package app.kilometr.tracking

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AlightSegmentTest {
  private val ride = LiveSegment("tram", "4", 0, 1_000_000, 1_600_000, 51.1, 17.0)
  private val transfer = LiveSegment("walk", "", 0, 1_600_000, 1_800_000)
  private val nextRide = LiveSegment("bus", "4", 0, 1_900_000, 2_500_000, 51.2, 17.1)
  private val plan = LiveTripPlan(
    tripId = "trip", deepLink = "", channelName = "", channelDescription = "",
    accentColor = 0, startAtMs = ride.startAtMs, endAtMs = nextRide.endAtMs,
    countdownAtMs = nextRide.endAtMs, countdownDown = true, delayMin = 0,
    stopAfterMs = nextRide.endAtMs + 180_000,
    segments = listOf(ride, transfer, nextRide), copy = emptyMap(),
    actions = emptyList(), states = emptyList(), alightAlertsEnabled = true,
  )

  @Test fun ignoresFutureLegsAndBoardingWindow() {
    assertNull(plan.alightSegmentAt(ride.startAtMs - 1))
    assertNull(plan.alightSegmentAt(ride.startAtMs + 44_999))
    assertEquals(ride, plan.alightSegmentAt(ride.startAtMs + 45_000)?.value)
  }

  @Test fun keepsAlightingStopAfterScheduledArrivalForDelayedVehicle() {
    assertEquals(ride, plan.alightSegmentAt(ride.endAtMs + 60_000)?.value)
  }

  @Test fun selectsNextRideWithoutAlertingDuringBoarding() {
    assertNull(plan.alightSegmentAt(nextRide.startAtMs))
    assertEquals(2, plan.alightSegmentAt(nextRide.startAtMs + 45_000)?.index)
    assertEquals(nextRide, plan.alightSegmentAt(nextRide.startAtMs + 45_000)?.value)
  }
}
