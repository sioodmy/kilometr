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
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicInteger

/**
 * Natywna powiadomienie śledząca podróż (Android).
 *
 * Dlaczego własny moduł, a nie samo expo-notifications: `NotificationContentInput`
 * nie ma pól `progress`, `setUsesChronometer` ani `setChronometerCountDown`.
 * Bez nich nie da się zrobić dwóch rzeczy, które robią powiadomienia
 * nawigacyjne w Mapach Google:
 *
 *  1. Paska postępu podróży.
 *  2. Chronometru odliczającego w dół do odjazdu / przyjazdu, tykającego co
 *     sekundę **bez udziału JS** — przy odświeżaniu co 20–30 s i tak nie
 *     dałoby się płynnego licznika, a budzenie procesu w tle tylko zjada
 *     baterię.
 *
 * Treść przychodzi z JS (src/services/notifications) już gotowa i przeliczona;
 * ten moduł odpowiada wyłącznie za render, kanał i przyciski.
 */
class KilometrTrackingModule : Module() {

  private val requestCounter = AtomicInteger(0)

  /**
   * `AppContext` nie wystawia `context` — jedynym bezpiecznym źródłem jest
   * `reactContext`. Bierzemy `applicationContext`, żeby nie trzymać Activity.
   * Zwykle `reactContext` jest żywy; null zdarza się w trakcie zamykania
   * procesu i wtedy po prostu nie pokazujemy powiadomienia.
   */
  private val appContextOrNull: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("KilometrTracking")

    Function("isAvailable") { true }

    AsyncFunction("ensureChannels") {
      appContextOrNull?.let { ensureChannel(it) }
    }

    AsyncFunction("present") { state: Map<String, Any?> ->
      render(state)
    }

    AsyncFunction("dismiss") {
      val ctx = appContextOrNull
      if (ctx != null) {
        try {
          NotificationManagerCompat.from(ctx).cancel(NOTIFICATION_ID)
        } catch (_: Throwable) {
          // powiadomienie mogło już zniknąć
        }
      }
    }
  }

  // ─── Kanał ───────────────────────────────────────────────────────────────

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      // LOW: aktualizacje co 20–30 s nie mogą dzwonić ani wibrować.
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

  // ─── Render ──────────────────────────────────────────────────────────────

  private fun render(state: Map<String, Any?>): Boolean {
    val context = appContextOrNull ?: return false
    return try {
      ensureChannel(context)
      val manager = NotificationManagerCompat.from(context)
      if (!manager.areNotificationsEnabled()) return false

      val title = state.str("title")
      if (title.isBlank()) return false

      val text = state.str("text")
      val subText = state.str("subText")
      val lineColor = state.str("lineColor").ifBlank { FALLBACK_COLOR }

      val builder = NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_kilometr_tram)
        .setColor(parseColor(lineColor))
        .setColorized(false)
        .setContentTitle(title)
        .setContentText(text)
        .setSubText(subText)
        .setStyle(
          NotificationCompat.BigTextStyle().bigText(
            listOf(text, subText).filter { it.isNotBlank() }.joinToString("\n"),
          ),
        )
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setContentIntent(openApp(context, state.str("deepLink"), 0))

      // Pasek postępu podróży (0..1000). Deterministyczny — system nie animuje
      // go sam, ale przy 20-sekundowym odświeżaniu krok jest ledwo widoczny.
      if (state.bool("showProgress")) {
        builder.setProgress(PROGRESS_MAX, state.int("progress").coerceIn(0, PROGRESS_MAX), false)
      } else {
        builder.setProgress(0, 0, false)
      }

      // Chronometr systemowy — kluczowe: liczy się po stronie systemu, więc
      // powiadomienie pokazuje live odliczanie nawet gdy proces leży w tle.
      val countdownAt = state.long("countdownAtMs")
      if (state.bool("showCountdown") && countdownAt > System.currentTimeMillis()) {
        builder.setWhen(countdownAt)
        builder.setUsesChronometer(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
          builder.setChronometerCountDown(state.bool("countdownDown"))
        }
      } else {
        builder.setUsesChronometer(false)
      }

      // Przyciski „Zakończ” i „Trasa”. Oba to deep linki, więc kliknięcie
      // wraca do aplikacji, a decyzję podejmuje JS — nie potrzebujemy
      // BroadcastReceivera ani budzenia procesu w tle.
      for ((_, actionTitle, url) in actionLinks(state)) {
        builder.addAction(
          NotificationCompat.Action.Builder(
            R.drawable.ic_kilometr_tram,
            actionTitle,
            openApp(context, url, requestCounter.incrementAndGet()),
          ).build(),
        )
      }

      // Dźwięku nie ustawiamy: kanał ma IMPORTANCE_LOW, a setOngoing +
      // setOnlyAlertOnce pilnują, żeby kolejne aktualizacje nie piszczały.
      manager.notify(NOTIFICATION_ID, builder.build())
      true
    } catch (_: SecurityException) {
      // brak POST_NOTIFICATIONS (Android 13+) — cicho, JS dostanie false
      false
    } catch (_: Throwable) {
      false
    }
  }

  /** Trójki (id, tytuł, deep link z akcją) — kolejność jak w notifications/content.ts. */
  @Suppress("UNCHECKED_CAST")
  private fun actionLinks(state: Map<String, Any?>): List<Triple<String, String, String>> {
    val raw = state["actions"] as? List<Map<String, Any?>> ?: return emptyList()
    val base = state.str("deepLink")
    val separator = if (base.contains('?')) "&" else "?"
    return raw.mapNotNull { entry ->
      val id = entry.str("id")
      val title = entry.str("title")
      if (id.isBlank() || title.isBlank()) return@mapNotNull null
      Triple(id, title, base + separator + "action=" + id)
    }
  }

  private fun openApp(context: Context, url: String, requestCode: Int): PendingIntent? {
    if (url.isBlank()) return null
    return try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        // Otwarcie z powiadomienia nie może tworzyć nowego zadania w multitaskingu.
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

  // ─── Pomocnicze ──────────────────────────────────────────────────────────

  private fun Map<String, Any?>.str(key: String): String = (this[key] as? String) ?: ""

  private fun Map<String, Any?>.int(key: String): Int = (this[key] as? Number)?.toInt() ?: 0

  private fun Map<String, Any?>.long(key: String): Long = (this[key] as? Number)?.toLong() ?: 0L

  private fun Map<String, Any?>.bool(key: String): Boolean = (this[key] as? Boolean) ?: false

  private fun parseColor(hex: String): Int =
    try {
      Color.parseColor(hex)
    } catch (_: IllegalArgumentException) {
      Color.parseColor(FALLBACK_COLOR)
    }

  private companion object {
    const val CHANNEL_ID = "kilometr.tracking"
    const val CHANNEL_NAME = "Śledzenie podróży"
    const val CHANNEL_DESCRIPTION = "Odliczanie do odjazdu i postęp podróży. Bez dźwięku."
    const val FALLBACK_COLOR = "#5CDBBE"
    const val PROGRESS_MAX = 1000
    /** Stały identyfikator: aktualizacja w miejscu, bez stosu powiadomień. */
    const val NOTIFICATION_ID = 0x4B4C // 'KL'
  }
}
