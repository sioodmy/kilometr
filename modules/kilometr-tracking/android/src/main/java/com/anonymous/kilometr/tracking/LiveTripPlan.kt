package com.anonymous.kilometr.tracking

import android.graphics.Color
import org.json.JSONObject

/**
 * Plan podróży w formie, którą rozumie natywna usługa.
 *
 * Wszystko, co UI pokazuje na ekranie blokady, dostarczamy z JS **raz na
 * fazę**, a nie raz na sekundę. Dzięki temu serwis Androida potrafi sam
 * przeliczać fazę i postęp podróży (czyste działania na czasie), a tekst
 * zawsze jest przetłumaczony i odmieniony po polsku, angielsku, niemiecku
 * i ukraińsku po stronie JS.
 *
 * Licznik odliczający w ogóle nie przychodzi z JS — rysuje go system przez
 * `setUsesChronometer`, więc tyka nawet wtedy, gdy proces leży.
 */
internal data class LiveTripPlan(
  val tripId: String,
  val deepLink: String,
  /** Kolor linii / pasa postępu. */
  val accentColor: Int,
  /** Początek podróży (z dojściem pieszo), ms. */
  val startAtMs: Long,
  /** Przyjazd na miejsce, ms. */
  val endAtMs: Long,
  /** Cel licznika systemowego, ms. */
  val countdownAtMs: Long,
  /** true → licznik w dół do `countdownAtMs`, false → liczy od niego w górę. */
  val countdownDown: Boolean,
  /** Opóźnienie kursu w minutach — steruje kolorem ostrzeżenia i chipem. */
  val delayMin: Int,
  /** Po tym czasie serwis sam się zatrzymuje (0 = nie). */
  val stopAfterMs: Long,
  val segments: List<LiveSegment>,
  val copy: Map<String, PhaseCopy>,
  val actions: List<TripAction>,
) {

  /** Trwałość całej podróży w ms — baza dla postępu i długości segmentów. */
  val totalMs: Long get() = maxOf(1L, endAtMs - startAtMs)

  /** Postęp 0..1000, liczony wyłącznie z zegara. */
  fun progressPermille(nowMs: Long): Int {
    val raw = ((nowMs - startAtMs).toDouble() / totalMs * PROGRESS_MAX).toInt()
    return raw.coerceIn(0, PROGRESS_MAX)
  }

  /**
   * Faza podróży wyłącznie z czasu i listy odcinków. Musi być zgodna z
   * `resolvePhase` w `tripProgress.ts` — inaczej pasek postępu pokazywałby
   * inną podróż niż tekst pod nim.
   */
  fun phaseAt(nowMs: Long): String {
    if (nowMs >= endAtMs) return PHASE_ARRIVED

    val boardIndex = segments.indexOfFirst { it.mode != MODE_WALK }
    if (boardIndex < 0) return PHASE_WALKING

    // Ostatni odcinek, który się już zaczął — nie pierwszy.
    var activeIndex = -1
    for (i in segments.indices) {
      if (nowMs >= segments[i].startAtMs) activeIndex = i
    }
    if (activeIndex < 0) {
      return if (segments[0].mode == MODE_WALK) PHASE_WALKING else PHASE_WAITING
    }

    val active = segments[activeIndex]
    if (active.mode == MODE_WALK) {
      return if (activeIndex > 0) PHASE_TRANSFER else PHASE_WALKING
    }
    if (nowMs < active.startAtMs + BOARDING_GRACE_MS) {
      return if (activeIndex == boardIndex) PHASE_WAITING else PHASE_TRANSFER
    }
    return PHASE_RIDING
  }

  fun copyFor(phase: String): PhaseCopy = copy[phase] ?: copy.values.firstOrNull() ?: EMPTY_COPY

  /** Serwis sam przestaje aktualizować powiadomienie po przyjeździe. */
  fun isExpired(nowMs: Long): Boolean = stopAfterMs in 1..nowMs

  /**
   * Długości segmentów w skali 0..1000.
   *
   * `Notification.ProgressStyle` bierze `progressMax` z SUMY długości
   * segmentów, a nie z ustawienia — więc suma musi domykać się dokładnie do
   * 1000. Inaczej pasek przesuwa się i ikona pojazdu stoi w złym miejscu.
   * Liczymy po granicach skumulowanych, nie po niezależnych udziałach, bo
   * przy 5 odcinkach błędy zaokrągleń kumulowałyby się o kilkanaście
   * permille.
   */
  fun segmentPermilles(): IntArray {
    val n = segments.size
    val out = IntArray(n)
    if (n == 0) return out
    val total = segments.sumOf { (it.endAtMs - it.startAtMs).toDouble() }
    if (total <= 0.0) {
      out[n - 1] = PROGRESS_MAX
      return out
    }
    var cumulative = 0.0
    var assigned = 0
    for (i in 0 until n) {
      cumulative += (segments[i].endAtMs - segments[i].startAtMs).toDouble()
      val boundary = Math.round(cumulative / total * PROGRESS_MAX).toInt()
      out[i] = boundary - assigned
      assigned = boundary
    }
    return out
  }

  /** Kolory segmentów w tej samej kolejności co `segmentPermilles`. */
  fun segmentColors(): IntArray = IntArray(segments.size) { segments[it].color }

  /** Pozycje granic przesiadek, 0..1000. */
  fun transferPoints(): List<Int> {
    val out = ArrayList<Int>()
    for (i in 1 until segments.size) {
      val prev = segments[i - 1]
      val cur = segments[i]
      if (prev.mode != MODE_WALK && cur.mode != MODE_WALK) {
        val pos = ((cur.startAtMs - startAtMs).toDouble() / totalMs * PROGRESS_MAX).toInt()
        out += pos.coerceIn(1, PROGRESS_MAX - 1)
      }
    }
    return out
  }

  /** Ikona „pojazdu" na pasku postępu — pokazuje, czym właśnie jedziemy. */
  fun trackerIconFor(nowMs: Long): Int {
    val active = segments.lastOrNull { nowMs >= it.startAtMs } ?: segments.firstOrNull()
    return when (active?.mode) {
      MODE_WALK -> R.drawable.ic_kilometr_walk
      MODE_BUS -> R.drawable.ic_kilometr_bus
      else -> R.drawable.ic_kilometr_tram
    }
  }

  companion object {
    const val MODE_WALK = "walk"
    const val MODE_TRAM = "tram"
    const val MODE_BUS = "bus"

    const val PHASE_WALKING = "walking"
    const val PHASE_WAITING = "waiting"
    const val PHASE_RIDING = "riding"
    const val PHASE_TRANSFER = "transfer"
    const val PHASE_ARRIVED = "arrived"

    /** Okno, w którym „wsiadanie" to jeszcze nie „w trasie" — jak w `tripProgress.ts`. */
    private const val BOARDING_GRACE_MS = 45_000L

    /** Skala paska postępu — ProgressStyle liczy progressMax z sumy segmentów. */
    const val PROGRESS_MAX = 1000

    const val FALLBACK_COLOR = "#5CDBBE"

    private val EMPTY_COPY = PhaseCopy("", "", "", "")

    /** Kolor dojścia/przesiadki pieszo — neutralny, żeby nie udawał linii. */
    const val WALK_COLOR = "#8A8F98"

    fun fromJson(json: String): LiveTripPlan? = try {
      val plan = parse(JSONObject(json))
      // Pusty plan albo zera w znacznikach czasu dałby pasek w 100% i
      // natychmiastowe zatrzymanie serwisu. Lepiej odrzucić niż pokazać
      // użytkownikowi nieprawdziwe „jesteś na miejscu”.
      if (plan.endAtMs <= plan.startAtMs || plan.copy.isEmpty()) null else plan
    } catch (_: Throwable) {
      null
    }

    private fun parse(root: JSONObject): LiveTripPlan {
      val segments = ArrayList<LiveSegment>()
      val rawSegments = root.optJSONArray("segments")
      if (rawSegments != null) {
        for (i in 0 until rawSegments.length()) {
          val o = rawSegments.optJSONObject(i) ?: continue
          val start = o.optLong("startAtMs", 0L)
          val end = o.optLong("endAtMs", start)
          if (end <= start) continue
          segments += LiveSegment(
            mode = o.optString("mode", MODE_WALK),
            line = o.optString("line", ""),
            color = parseColor(o.optString("color", ""), WALK_COLOR),
            startAtMs = start,
            endAtMs = end,
          )
        }
      }
      segments.sortBy { it.startAtMs }

      val copy = HashMap<String, PhaseCopy>()
      val rawCopy = root.optJSONObject("copy")
      if (rawCopy != null) {
        for (phase in PHASES) {
          val o = rawCopy.optJSONObject(phase) ?: continue
          copy[phase] = PhaseCopy(
            title = o.optString("title", ""),
            text = o.optString("text", ""),
            subText = o.optString("subText", ""),
            criticalText = o.optString("criticalText", ""),
          )
        }
      }

      val actions = ArrayList<TripAction>()
      val rawActions = root.optJSONArray("actions")
      if (rawActions != null) {
        for (i in 0 until rawActions.length()) {
          val o = rawActions.optJSONObject(i) ?: continue
          val id = o.optString("id", "")
          val title = o.optString("title", "")
          if (id.isBlank() || title.isBlank()) continue
          actions += TripAction(id, title)
        }
      }

      LiveTripPlan(
        tripId = root.optString("tripId", ""),
        deepLink = root.optString("deepLink", ""),
        accentColor = parseColor(root.optString("accentColor", ""), FALLBACK_COLOR),
        startAtMs = root.optLong("startAtMs", 0L),
        endAtMs = root.optLong("endAtMs", 0L),
        countdownAtMs = root.optLong("countdownAtMs", 0L),
        countdownDown = root.optBoolean("countdownDown", true),
        delayMin = root.optInt("delayMin", 0),
        stopAfterMs = root.optLong("stopAfterMs", 0L),
        segments = segments,
        copy = copy,
        actions = actions,
      )
    }

    private val PHASES = arrayOf(PHASE_WALKING, PHASE_WAITING, PHASE_RIDING, PHASE_TRANSFER, PHASE_ARRIVED)

    private fun parseColor(hex: String, fallback: String): Int = try {
      Color.parseColor(hex)
    } catch (_: Throwable) {
      Color.parseColor(fallback)
    }
  }
}

/** Jeden odcinek podróży: dojście pieszo albo przejazd pojazdem. */
internal data class LiveSegment(
  val mode: String,
  val line: String,
  val color: Int,
  val startAtMs: Long,
  val endAtMs: Long,
)

/**
 * Treść powiadomienia dla jednej fazy. `criticalText` trafia na chip w pasku
 * stanu (Android 16.1+) — tam liczy się absolutna godzina, a nie „za 4 min",
 * bo chip nie odświeża się sam i szybko zacząłby kłamać.
 */
internal data class PhaseCopy(
  val title: String,
  val text: String,
  val subText: String,
  val criticalText: String,
)

/** Przycisk pod powiadomieniem. */
internal data class TripAction(val id: String, val title: String)