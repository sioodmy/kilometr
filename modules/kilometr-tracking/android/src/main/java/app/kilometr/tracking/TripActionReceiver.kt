package app.kilometr.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.app.NotificationManager
import expo.modules.notifications.service.delegates.ExpoSchedulingDelegate

/**
 * Przycisk „Zakończ" pod powiadomieniem.
 *
 * Świadomie nie robimy deep linku do aplikacji: użytkownik kończy śledzenie
 * jednym dotknięciem i oczekuje, że powiadomienie zniknie, a nie że
 * wskoczy mu ekran połączeń. Akcję obsługujemy natywnie, a JS dowiaduje się
 * o niej przy najbliższym aktywnym ticku albo przy starcie aplikacji — do
 * tego czasu powiadomienia już nie ma, więc nie ma też okna, w którym
 * śledzenie udawałoby, że trwa.
 */
class TripActionReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_STOP) return
    LocalStopSignal.mark(context)
    TripAlerts.cancel(context)
    try {
      context.stopService(Intent(context, LiveTripService::class.java))
      val manager = context.getSystemService(NotificationManager::class.java)
      manager.cancel(LiveUpdateFactory.NOTIFICATION_ID)
    } catch (_: Throwable) {
      // JS ponowi zatrzymanie po odczytaniu flagi.
      LocalStopSignal.mark(context)
    }
  }

  companion object {
    const val ACTION_STOP = "app.kilometr.tracking.action.STOP"
  }
}

internal object TripAlerts {
  fun cancel(context: Context) {
    try {
      val scheduler = ExpoSchedulingDelegate(context)
      val ids = scheduler.getAllScheduledNotifications()
        .map { it.identifier }.filter { it.startsWith("kilometr.alert.") }
      scheduler.removeScheduledNotifications(ids)
      val manager = context.getSystemService(NotificationManager::class.java)
      for (notification in manager.activeNotifications) {
        if (notification.tag?.startsWith("kilometr.alert.") == true || notification.tag == "kilometr.tracking.v2") {
          manager.cancel(notification.tag, notification.id)
        }
      }
    } catch (_: Exception) {
      // JS ponawia sprzątanie po wznowieniu aplikacji.
    }
  }
}

/**
 * Jednokierunkowy kanał „natywny zakończył śledzenie → JS jeszcze nie wie".
 *
 * Zapis w SharedPreferences, bo intencja do odbiorcy nie wraca do procesu
 * aplikacji. Zakładka z flagą, którą JS zjada raz — inaczej zatrzymanie
 * powtórzyłoby się po każdym restarcie procesu.
 */
internal object LocalStopSignal {

  private const val PREFS = "kilometr.tracking"
  private const val KEY_PENDING = "pendingStop"

  fun mark(context: Context) {
    prefs(context).edit().putBoolean(KEY_PENDING, true).apply()
  }

  fun isPending(context: Context): Boolean = prefs(context).getBoolean(KEY_PENDING, false)

  /** Zwraca true raz, potem czyści flagę. */
  fun consume(context: Context): Boolean {
    val prefs = prefs(context)
    if (!prefs.getBoolean(KEY_PENDING, false)) return false
    prefs.edit().remove(KEY_PENDING).apply()
    return true
  }

  fun clear(context: Context) {
    prefs(context).edit().remove(KEY_PENDING).apply()
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
