package my.siood.kilometr.tracking

internal class AlightProximity {
  private val alerted = HashSet<String>()

  fun hasAlerted(key: String): Boolean = key in alerted

  fun shouldAlert(key: String, distanceM: Float, accuracyM: Float, ageMs: Long): Boolean {
    if (!distanceM.isFinite() || distanceM !in 0f..100f) return false
    if (!accuracyM.isFinite() || accuracyM !in 0f..35f) return false
    if (ageMs !in 0L..10_000L) return false
    return alerted.add(key)
  }

  fun clear() = alerted.clear()
}
