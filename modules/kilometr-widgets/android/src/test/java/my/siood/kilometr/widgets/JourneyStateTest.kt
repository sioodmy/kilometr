package my.siood.kilometr.widgets

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class JourneyStateTest {
  private val depart = 1_000_000L
  private val arrive = 2_000_000L

  @Test fun followsTripAndReturnsToDepartures() {
    assertEquals(JourneyPhase.BEFORE, journeyPhase(depart, arrive, depart - 1))
    assertEquals(JourneyPhase.RIDING, journeyPhase(depart, arrive, depart))
    assertEquals(JourneyPhase.RIDING, journeyPhase(depart, arrive, arrive - 1))
    assertEquals(JourneyPhase.ARRIVED, journeyPhase(depart, arrive, arrive))
    assertEquals(JourneyPhase.ARRIVED, journeyPhase(depart, arrive, arrive + ARRIVAL_LINGER_MS))
    assertNull(journeyPhase(depart, arrive, arrive + ARRIVAL_LINGER_MS + 1))
  }

  @Test fun missingOrInvalidTripShowsDepartures() {
    assertNull(journeyPhase(null, arrive, depart))
    assertNull(journeyPhase(depart, null, depart))
    assertNull(journeyPhase(0, arrive, depart))
    assertNull(journeyPhase(depart, depart, depart))
    assertNull(journeyPhase(arrive, depart, depart))
  }
}
