package app.kilometr.tracking

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AlightProximityTest {
  @Test fun alertsInside100MetersOnlyOncePerLeg() {
    val proximity = AlightProximity()
    assertFalse(proximity.shouldAlert("1:4", 120f, 10f, 0))
    assertTrue(proximity.shouldAlert("1:4", 100f, 10f, 0))
    assertFalse(proximity.shouldAlert("1:4", 60f, 10f, 0))
    assertTrue(proximity.hasAlerted("1:4"))
    assertTrue(proximity.shouldAlert("3:4", 75f, 10f, 0))
    proximity.clear()
    assertTrue(proximity.shouldAlert("1:4", 90f, 10f, 0))
  }

  @Test fun rejectsStaleAndInaccurateFixesWithoutConsumingAlert() {
    val proximity = AlightProximity()
    assertFalse(proximity.shouldAlert("1:4", 80f, 100f, 0))
    assertFalse(proximity.shouldAlert("1:4", 80f, 10f, 10_001))
    assertFalse(proximity.shouldAlert("1:4", 80f, 10f, -1))
    assertFalse(proximity.shouldAlert("1:4", Float.NaN, 10f, 0))
    assertFalse(proximity.shouldAlert("1:4", 80f, Float.NaN, 0))
    assertFalse(proximity.hasAlerted("1:4"))
    assertTrue(proximity.shouldAlert("1:4", 80f, 35f, 10_000))
  }
}
