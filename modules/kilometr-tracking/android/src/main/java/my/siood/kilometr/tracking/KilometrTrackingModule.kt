package my.siood.kilometr.tracking

import android.content.Context
import android.content.Intent
import android.provider.Settings
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

    AsyncFunction("ensureChannels") { name: String, description: String ->
      appContextOrNull?.let { LiveUpdateFactory.ensureChannel(it, name, description) }
    }

    /** Czy system dopuści powiadomienie do strefy Live Updates. */
    AsyncFunction("canPromote") {
      appContextOrNull?.let { LiveUpdateFactory.canPromote(it) } ?: false
    }

    AsyncFunction("openNotificationSettings") {
      val context = appContextOrNull ?: return@AsyncFunction false
      try {
        context.startActivity(
          Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        true
      } catch (_: Throwable) {
        false
      }
    }

    /**
     * Surowa paleta Material You z tapety (`rodzina_ton` → `#RRGGBBAA`).
     * Pusta na Androidzie 11 i starszych — wtedy zostaje własna paleta.
     */
    AsyncFunction("getSystemPalette") {
      appContextOrNull?.let { DynamicColors.read(it) } ?: emptyMap<String, String>()
    }

    /** Wysyła plan do serwisu: startuje go albo aktualizuje w locie. */
    AsyncFunction("startTrip") { json: String ->
      val context = appContextOrNull ?: return@AsyncFunction false
      val plan = LiveTripPlan.fromJson(json) ?: return@AsyncFunction false
      LiveUpdateFactory.ensureChannel(context, plan.channelName, plan.channelDescription)
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

    /** Startuje ContributorService z metadanymi sesji (deviceId, kurs, teksty). */
    AsyncFunction("startContributor") { json: String ->
      val context = appContextOrNull ?: return@AsyncFunction false
      ContributorService.start(context, json)
    }

    /** Zatrzymuje ContributorService i zdejmie powiadomienie. */
    AsyncFunction("stopContributor") {
      val context = appContextOrNull ?: return@AsyncFunction false
      ContributorService.stop(context)
    }

    /** Czy FGS telemetrii obecnie biega. */
    Function("isContributorRunning") { ContributorService.isRunning }
  }
}
