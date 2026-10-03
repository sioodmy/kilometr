package com.anonymous.kilometr.tracking

import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Most między JS a natywnym Live Update.
 *
 * JS nie rysuje powiadomienia — dostarcza plan podróży (odcinki, teksty dla
 * każdej fazy, akcje) i od tego momentu pilnuje go `LiveTripService`. Dzięki
 * temu powiadomienie przeżywa zamknięcie aplikacji, a licznik i pasek postępu
 * tykają bez udziału procesu JS.
 *
 * Plan leci jako JSON, a nie jako mapa expo-modułu: `Map<String, Any?>`
 * gubi typy przy gęstszych strukturach, a JSON jest jednoznaczny i tani.
 */
class KilometrTrackingModule : Module() {

  /**
   * `AppContext` nie wystawia `context` — jedynym bezpiecznym źródłem jest
   * `reactContext`. Bierzemy `applicationContext`, żeby nie trzymać Activity.
   */
  private val appContextOrNull: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("KilometrTracking")

    Function("isAvailable") { true }

    AsyncFunction("ensureChannels") {
      appContextOrNull?.let { LiveUpdateFactory.ensureChannel(it) }
    }

    /** Czy system dopuści powiadomienie do strefy Live Updates. */
    AsyncFunction("canPromote") {
      appContextOrNull?.let { LiveUpdateFactory.canPromote(it) } ?: false
    }

    /** Wysyła plan do serwisu: startuje go albo aktualizuje w locie. */
    AsyncFunction("startTrip") { json: String ->
      val context = appContextOrNull ?: return@AsyncFunction false
      LiveTripPlan.fromJson(json) ?: return@AsyncFunction false
      LiveUpdateFactory.ensureChannel(context)
      val manager = NotificationManagerCompat.from(context)
      if (!manager.areNotificationsEnabled()) return@AsyncFunction false

      val intent: Intent = LiveTripService.planIntent(context, json)
      try {
        if (LiveTripService.isRunning) {
          // Usługa już stoi w pierwszym planie, więc zwykły startService
          // wystarczy — i jest jedynym legalnym wariantem z tła (Android 12+
          // rzuca wyjątkiem na startForegroundService spoza pierwszego planu).
          context.startService(intent)
        } else {
          ContextCompat.startForegroundService(context, intent)
        }
      } catch (_: Throwable) {
        return@AsyncFunction false
      }
      true
    }

    /** Zatrzymuje śledzenie i zdejmuje powiadomienie. */
    AsyncFunction("stopTrip") {
      val context = appContextOrNull ?: return@AsyncFunction false
      LocalStopSignal.clear(context)
      val intent = Intent(context, LiveTripService::class.java).apply {
        action = LiveTripService.ACTION_STOP
      }
      try {
        context.startService(intent)
      } catch (_: Throwable) {
        // Serwis nie istnieje — wystarczy zdjąć powiadomienie.
      }
      try {
        NotificationManagerCompat.from(context).cancel(LiveUpdateFactory.NOTIFICATION_ID)
      } catch (_: Throwable) {
        // powiadomienie mogło już zniknąć
      }
      true
    }

    /** Czy przycisk „Zakończ" pod powiadomieniem właśnie zadziałał natywnie. */
    AsyncFunction("consumeStopRequest") {
      appContextOrNull?.let { LocalStopSignal.consume(it) } ?: false
    }
  }
}