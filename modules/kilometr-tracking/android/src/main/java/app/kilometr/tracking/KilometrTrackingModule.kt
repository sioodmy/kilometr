package app.kilometr.tracking

import android.content.Context
import android.content.Intent
import android.location.Location
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Most między JS a natywnym Live Update.
 *
 * JS nie rysuje powiadomienia - dostarcza plan podróży (odcinki, teksty dla
 * każdej fazy, akcje) i od tego momentu pilnuje go `LiveTripService`. Dzięki
 * temu powiadomienie przeżywa zamknięcie aplikacji, a licznik i pasek postępu
 * tykają bez udziału procesu JS.
 *
 * Plan leci jako JSON, a nie jako mapa expo-modułu: `Map<String, Any?>`
 * gubi typy przy gęstszych strukturach, a JSON jest jednoznaczny i tani.
 */
class KilometrTrackingModule : Module() {

  companion object {
    /**
     * LiveTripService żyje poza Expo i nie ma dostępu do `appContext` - mostek
     * do `sendEvent` trzymamy tu. Null, gdy moduł jeszcze nie powstał (JS nie działa).
     */
    @Volatile
    private var instance: KilometrTrackingModule? = null

    /** Pomiar GPS z serwisu śledzącego → JS (tripMonitor liczy z niego opóźnienie). */
    fun emitTripLocation(location: Location) {
      val module = instance ?: return
      try {
        module.sendEvent(
          "onTripLocation",
          mapOf<String, Any?>(
            "lat" to location.latitude,
            "lon" to location.longitude,
            "accuracy" to (if (location.hasAccuracy()) location.accuracy.toDouble() else null),
            "speed" to (if (location.hasSpeed()) location.speed.toDouble() else null),
            "heading" to (if (location.hasBearing()) location.bearing.toDouble() else null),
            "timestamp" to location.time,
          ),
        )
      } catch (_: Throwable) {
        // JS może być właśnie martwe (proces ubity, serwis dalej żyje)
      }
    }
  }

  /**
   * `AppContext` nie wystawia `context` - jedynym bezpiecznym źródłem jest
   * `reactContext`. Bierzemy `applicationContext`, żeby nie trzymać Activity.
   */
  private val appContextOrNull: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("KilometrTracking")

    Events("onTripLocation")

    OnCreate {
      instance = this@KilometrTrackingModule
    }

    OnDestroy {
      if (instance === this@KilometrTrackingModule) instance = null
    }

    Function("isAvailable") { true }
    Function("supportsTransferDecisions") { true }

    AsyncFunction("configureTransferProtection") { tripId: String, path: String ->
      val context = appContextOrNull ?: return@AsyncFunction false
      if (LiveTripService.activeTripId != tripId) return@AsyncFunction false
      val file = java.io.File(path.removePrefix("file://"))
      if (!file.canonicalPath.startsWith(context.filesDir.canonicalPath + "/") || !file.isFile) return@AsyncFunction false
      TransferProtection.configure(context, tripId, path)
      true
    }

    AsyncFunction("getTransferProtectionState") {
      appContextOrNull?.let { TransferProtection.readState(it) }
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
     * Pusta na Androidzie 11 i starszych - wtedy zostaje własna paleta.
     */
    AsyncFunction("getSystemPalette") {
      appContextOrNull?.let { DynamicColors.read(it) } ?: emptyMap<String, String>()
    }

    /** Wysyła plan do serwisu: startuje go albo aktualizuje w locie. */
    AsyncFunction("startTrip") { json: String ->
      val context = appContextOrNull ?: return@AsyncFunction false
      val plan = LiveTripPlan.fromJson(json) ?: return@AsyncFunction false
      if (LocalStopSignal.isPending(context)) return@AsyncFunction false
      LiveUpdateFactory.ensureChannel(context, plan.channelName, plan.channelDescription)
      val manager = NotificationManagerCompat.from(context)
      if (!manager.areNotificationsEnabled()) return@AsyncFunction false

      val intent: Intent = LiveTripService.planIntent(context, json)
      try {
        if (LiveTripService.isRunning) {
          // Usługa już stoi w pierwszym planie, więc zwykły startService
          // wystarczy - i jest jedynym legalnym wariantem z tła (Android 12+
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
      TransferProtection.clear(context)
      TransferPresentation.cancel(context)
      try {
        context.stopService(Intent(context, LiveTripService::class.java))
      } catch (_: Throwable) {
        // Serwis nie istnieje - wystarczy zdjąć powiadomienie.
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

    AsyncFunction("hasStopRequest") {
      appContextOrNull?.let { LocalStopSignal.isPending(it) } ?: false
    }
  }
}
