package my.siood.kilometr.widgets

internal const val ARRIVAL_LINGER_MS = 2 * 60_000L

internal enum class JourneyPhase { BEFORE, RIDING, ARRIVED }

internal fun journeyPhase(depart: Long?, arrive: Long?, now: Long): JourneyPhase? {
  if (depart == null || arrive == null || depart <= 0 || arrive <= depart) return null
  if (now > arrive && now - arrive > ARRIVAL_LINGER_MS) return null
  return when {
    now < depart -> JourneyPhase.BEFORE
    now < arrive -> JourneyPhase.RIDING
    else -> JourneyPhase.ARRIVED
  }
}
