package com.anonymous.kilometr.tracking

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

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
    val stop = Intent(context, LiveTripService::class.java).apply {
      action = LiveTripService.ACTION_STOP
    }
    try {
      context.startService(stop)
    } catch (_: Throwable) {
      // Android 26+ nie pozwala podnieść usługi z tła — powiadomienie i tak
      // zniknie razem z procesem, a `LocalStopSignal` dowozi decyzję do JS.
      LocalStopSignal.mark(context)
    }
  }

  companion object {
    const val ACTION_STOP = "com.anonymous.kilometr.tracking.action.STOP"
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