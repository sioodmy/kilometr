package com.anonymous.kilometr.tracking

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Budowa powiadomienia śledzącego.
 *
 * Na Androidzie 16 (`Notification.ProgressStyle`) pokazujemy podróż jako pasek
 * z segmentami: dojścia pieszo w kolorze neutralnym, przejazdy w kolorze
 * linii, granice przesiadek jako punkty, a nad paskiem ikona tego, czym
 * jedziemy. Do tego „promocja do Live Updates" — powiadomienie wchodzi w
 * strefę Live Updates na ekranie blokady i dostaje chip w pasku stanu.
 *
 * Android nie ma RemoteViews dla takiego powiadomienia (i to jest warunek
 * Live Updates), więc wygląd jest w całości szablonem systemu — my
 * odpowiadamy tylko za treść, segmenty i ikony. Na starszych wersjach
 * `ProgressStyle` cicho nic nie robi, a `setProgress` daje zwykły pasek.
 */
internal object LiveUpdateFactory {

  const val CHANNEL_ID = "kilometr.tracking"
  const val NOTIFICATION_ID = 0x4B4C // 'KL'

  /** Android 16 — `ProgressStyle` i Live Updates. */
  private const val ANDROID_16 = 36

  private const val CHANNEL_NAME = "Śledzenie podróży"
  private const val CHANNEL_DESCRIPTION = "Postęp podróży i odliczanie do odjazdu. Bez dźwięku."

  /** Akcent powiadomienia, gdy kurs się spóźnia. */
  private val DELAY_COLOR = Color.parseColor("#E5484D")

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      // LOW: postęp przesuwa się co sekundę, więc dźwięk i wibracje były
      // uciążliwe. Alerty odjazdu mają osobny, głośny kanał.
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = CHANNEL_DESCRIPTION
      setShowBadge(false)
      enableVibration(false)
      enableLights(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setSound(null, null)
    }
    manager.createNotificationChannel(channel)
  }

  fun build(context: Context, plan: LiveTripPlan, nowMs: Long): Notification {
    val phase = plan.phaseAt(nowMs)
    val copy = plan.copyFor(phase)
    val delayed = plan.delayMin >= 2

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_kilometr_tram)
      .setColor(if (delayed) DELAY_COLOR else plan.accentColor)
      .setColorized(false)
      .setContentTitle(copy.title)
      .setContentText(copy.text)
      .setSubText(copy.subText)
      .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      // Aktualizuj co sekundę — bez tego system mógłby odłożyć refresh.
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setSilent(true)
      .setContentIntent(openApp(context, plan.deepLink, REQUEST_CONTENT))

    val big = listOf(copy.text, copy.subText).filter { it.isNotBlank() }.joinToString("\n")

    applyChronometer(builder, plan, phase, nowMs)

    // Android 16 rysuje pasek z segmentami i sam definiuje wygląd całego
    // powiadomienia. Na starszych zostaje klasyczny pasek postępu — i tam
    // potrzebujemy BigText, bo bez niego rozwinięcie powiadomienia dawałoby
    // pustkę (system pokazałby tylko dwie linijki, które i tak są widoczne).
    val progress = plan.progressPermille(nowMs)
    if (Build.VERSION.SDK_INT >= ANDROID_16) {
      builder.setStyle(progressStyle(context, plan, progress, nowMs))
    } else {
      if (big.isNotBlank()) builder.setStyle(NotificationCompat.BigTextStyle().bigText(big))
      builder.setProgress(progress, LiveTripPlan.PROGRESS_MAX, false)
    }

    // Live Update: musi być trwałe, mieć tytuł i nie używać RemoteViews —
    // wszystkie trzy warunki spełniamy. Chip w pasku stanu to informacja
    // priorytetowa, więc opóźnienie wygrywa z godziną (patrz `buildLivePlan`).
    if (Build.VERSION.SDK_INT >= ANDROID_16 && copy.criticalText.isNotBlank()) {
      builder.setShortCriticalText(copy.criticalText)
    }
    builder.setRequestPromotedOngoing(true)

    for (action in plan.actions) {
      builder.addAction(
        NotificationCompat.Action.Builder(
          actionIcon(action.id),
          action.title,
          actionIntent(context, plan, action),
        ).build(),
      )
    }

    return builder.build()
  }

  /**
   * Licznik systemowy. Nie animujemy go z serwisu — `setWhen` + chronometr
   * wystarczą, a tyka w trakcie, gdy proces jest wyciszony.
   */
  private fun applyChronometer(
    builder: NotificationCompat.Builder,
    plan: LiveTripPlan,
    phase: String,
    nowMs: Long,
  ) {
    val at = plan.countdownAtMs
    if (phase == LiveTripPlan.PHASE_ARRIVED) {
      // Po przyjeździe liczymy w górę: „14:51 · 3 min". To mówi, że cel
      // osiągnięto, zamiast zostawiać zatrzymany licznik.
      builder.setWhen(at)
      builder.setUsesChronometer(true)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) builder.setChronometerCountDown(false)
      return
    }
    if (at <= 0L) {
      builder.setUsesChronometer(false)
      return
    }
    builder.setWhen(at)
    builder.setUsesChronometer(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      // Po odjeździe licznik w dół miałby pokazywać minusy — wtedy liczymy w górę.
      builder.setChronometerCountDown(plan.countdownDown && at > nowMs)
    }
  }

  /**
   * Pasek podróży jako segmenty: dojścia pieszo w kolorze neutralnym, przejazdy
   * w kolorze linii, granice przesiadek jako punkty, a na pasku ikona tego,
   * czym jedziemy.
   *
   * Lewego końca paska celowo nie opisujemy — flaga odjazdu tylko zabierała
   * miejsce i myliła się z paskiem postępu, bo wyglądała jak kolejny punkt
   * trasy. Z prawej zostaje flaga z metra: mówi „jeszcze tu są przystanki”.
   */
  private fun progressStyle(
    context: Context,
    plan: LiveTripPlan,
    progress: Int,
    nowMs: Long,
  ): NotificationCompat.ProgressStyle {
    val style = NotificationCompat.ProgressStyle()
      .setStyledByProgress(false)
      .setProgressTrackerIcon(IconCompat.createWithResource(context, plan.trackerIconFor(nowMs)))
      .setProgressEndIcon(IconCompat.createWithResource(context, R.drawable.ic_kilometr_flag2))

    // `ProgressStyle` wylicza `progressMax` z sumy długości segmentów, więc
    // albo domykamy sumę do 1000, albo dostajemy pasek przesunięty o kilka
    // permile względem ikony pojazdu.
    val permilles = plan.segmentPermilles()
    val colors = plan.segmentColors()
    var drawn = 0
    for (i in permilles.indices) {
      if (permilles[i] <= 0) continue
      drawn += permilles[i]
      style.addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(permilles[i]).setColor(colors[i]),
      )
    }
    if (drawn == 0) {
      style.addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(LiveTripPlan.PROGRESS_MAX).setColor(plan.accentColor),
      )
    }
    for (pos in plan.transferPoints()) {
      style.addProgressPoint(NotificationCompat.ProgressStyle.Point(pos).setColor(plan.accentColor))
    }
    return style.setProgress(progress)
  }

  private fun actionIcon(id: String): Int = when (id) {
    ACTION_STOP -> R.drawable.ic_kilometr_stop
    ACTION_ROUTE -> R.drawable.ic_kilometr_route
    else -> R.drawable.ic_kilometr_route
  }

  /**
   * „Zakończ" obsługuje natywnie, bez budzenia JS — inaczej po ubiciu
   * procesu przycisk nic by nie zrobił. Pozostałe akcje to deep link do
   * aplikacji, bo decyzję o tym, gdzie trafić, podejmuje router.
   */
  private fun actionIntent(
    context: Context,
    plan: LiveTripPlan,
    action: TripAction,
  ): PendingIntent? {
    if (action.id == ACTION_STOP) {
      val intent = Intent(context, TripActionReceiver::class.java).apply {
        // `this.action` — bez `this.` resolver sięgnąłby do parametru
        // `action: TripAction`, który jest val.
        this.action = TripActionReceiver.ACTION_STOP
      }
      return PendingIntent.getBroadcast(
        context,
        REQUEST_STOP,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    // Przycisk trasy prowadzi prosto do szczegółów śledzonego kursu, a nie na
    // listę połączeń — to o dwa dotknięcia bliżej tego, czego szuka użytkownik
    // w trakcie podróży. `tripId` jest stabilny (to id z listy połączeń),
    // więc zawsze trafiamy w ten sam ekran.
    val url = appendRoute(plan.deepLink, plan.tripId)
    return openApp(context, url, REQUEST_ACTIONS + action.id.hashCode())
  }

  private fun openApp(context: Context, url: String, requestCode: Int): PendingIntent? {
    if (url.isBlank()) return null
    return try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        flags = flags or Intent.FLAG_ACTIVITY_SINGLE_TOP
      }
      PendingIntent.getActivity(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    } catch (_: Throwable) {
      null
    }
  }

  private fun appendRoute(deepLink: String, tripId: String): String {
    if (deepLink.isBlank()) return deepLink
    val separator = if (deepLink.contains('?')) "&" else "?"
    val target = if (tripId.isBlank()) "" else "&open=" + Uri.encode(tripId)
    return deepLink + separator + "action=route" + target
  }

  /** Czy system w ogóle pozwoli promować powiadomienie do Live Updates. */
  fun canPromote(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < ANDROID_16) return false
    return try {
      val manager = context.getSystemService(NotificationManager::class.java)
      manager?.canPostPromotedNotifications() ?: false
    } catch (_: Throwable) {
      false
    }
  }

  const val ACTION_STOP = "stop"
  const val ACTION_ROUTE = "route"

  private const val REQUEST_CONTENT = 1
  private const val REQUEST_STOP = 2
  private const val REQUEST_ACTIONS = 100
}