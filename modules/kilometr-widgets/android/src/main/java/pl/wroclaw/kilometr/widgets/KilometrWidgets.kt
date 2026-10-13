package pl.wroclaw.kilometr.widgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.RemoteViews
import org.json.JSONObject

/** Wspólne odświeżanie: każdy provider przerysowuje wszystkie widgety naraz, bo czytają ten sam snapshot. */
internal object KilometrWidgets {

  /** Dalej niż 12 h w przód nie tykamy co minutę, i tak pokazujemy wtedy godzinę. */
  private const val TICK_HORIZON_MS = 12 * 3_600_000L

  fun updateAll(context: Context) {
    val app = context.applicationContext
    val manager = AppWidgetManager.getInstance(app) ?: return
    val snap = WidgetSnapshot.read(app)
    val now = System.currentTimeMillis()
    var countdownShown = false

    fun each(cls: Class<*>, render: (Int, Bundle?) -> RemoteViews) {
      val ids = try {
        manager.getAppWidgetIds(ComponentName(app, cls))
      } catch (_: Throwable) {
        IntArray(0)
      }
      if (
        ids.isNotEmpty() &&
        cls != SearchWidget::class.java &&
        cls != SavedPlacesWidget::class.java
      ) countdownShown = true
      for (id in ids) {
        try {
          manager.updateAppWidget(id, render(id, manager.getAppWidgetOptions(id)))
        } catch (_: Throwable) {
          // Jeden zepsuty widget nie może zatrzymać pozostałych.
        }
      }
    }

    each(NextDepartureWidget::class.java) { id, _ -> WidgetRenderers.next(app, snap, id, now) }
    each(DestinationsWidget::class.java) { id, opts -> WidgetRenderers.destinations(app, snap, id, opts, now) }
    each(TripWidget::class.java) { id, _ -> WidgetRenderers.trip(app, snap, id, now) }
    each(SearchWidget::class.java) { id, opts -> WidgetRenderers.search(app, snap, id, opts) }
    each(SavedPlacesWidget::class.java) { id, opts -> WidgetRenderers.savedPlaces(app, snap, id, opts) }

    LauncherShortcuts.sync(app, snap)
    WidgetTicker.schedule(app, countdownShown && hasUpcoming(snap, now))
  }

  private fun hasUpcoming(snap: JSONObject?, now: Long): Boolean {
    if (snap == null) return false
    val from = now - 60_000L
    val until = now + TICK_HORIZON_MS
    fun inWindow(ts: Long?) = ts != null && ts in from..until
    if (snap.optJSONArray("next").objects().any { inWindow(it.optLongOrNull("departTs")) }) return true
    if (snap.optJSONArray("quick").objects().any { inWindow(it.optLongOrNull("departTs")) }) return true
    val trip = snap.optJSONObject("pinned") ?: return false
    val arrive = trip.optLongOrNull("arriveTs") ?: return false
    return arrive + 20 * 60_000L >= now && (trip.optLongOrNull("departTs") ?: arrive) <= until
  }
}

/**
 * Tyknięcie na pełną minutę. Alarm RTC (nie budzący) przychodzi tylko przy
 * włączonym ekranie, więc odliczanie żyje, kiedy ktoś na nie patrzy, a w
 * kieszeni nie kosztuje baterii.
 */
internal object WidgetTicker {
  private const val ACTION_TICK = "pl.wroclaw.kilometr.widgets.TICK"

  fun schedule(context: Context, active: Boolean) {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return
    val intent = Intent(context, WidgetTickReceiver::class.java).setAction(ACTION_TICK)
    val pending = PendingIntent.getBroadcast(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    if (!active) {
      alarms.cancel(pending)
      return
    }
    val nextMinute = (System.currentTimeMillis() / 60_000L + 1) * 60_000L + 500L
    try {
      alarms.setWindow(AlarmManager.RTC, nextMinute, 5_000L, pending)
    } catch (_: Throwable) {
      // Bez alarmu widget i tak odświeży się z updatePeriodMillis i po otwarciu apki.
    }
  }
}

class WidgetTickReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    KilometrWidgets.updateAll(context)
  }
}

abstract class KilometrWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    KilometrWidgets.updateAll(context)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    KilometrWidgets.updateAll(context)
  }

  override fun onDisabled(context: Context) {
    KilometrWidgets.updateAll(context)
  }
}

class NextDepartureWidget : KilometrWidgetProvider()
class DestinationsWidget : KilometrWidgetProvider()
class TripWidget : KilometrWidgetProvider()
class SearchWidget : KilometrWidgetProvider()
class SavedPlacesWidget : KilometrWidgetProvider()
