package app.kilometr.tracking

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import kotlin.math.max

internal object TransferPresentation {
  private const val ALERT_ID = 0x4B50
  private const val CHANNEL = "kilometr.transfers"

  fun decorate(plan: LiveTripPlan, state: JSONObject?, now: Long): LiveTripPlan {
    if (state == null || state.optString("tripId") != plan.tripId) return plan
    val connection = state.optJSONObject("connection") ?: return plan
    val baseMs = state.optLong("baseMs")
    if (baseMs == 0L) return plan
    val legs = connection.getJSONArray("legs")
    val active = state.optInt("activeLegIndex", -1)
    var previous = plan.startAtMs
    val segments = (0 until legs.length()).map { i ->
      val leg = legs.getJSONObject(i)
      var departure = baseMs + clockSec(leg.getString("departAt")) * 1000L
      while (departure < previous - 60_000) departure += 86_400_000
      var arrival = baseMs + clockSec(leg.getString("arriveAt")) * 1000L
      while (arrival < departure) arrival += 86_400_000
      if (i == active && state.has("arrivalAtMs")) arrival = state.getLong("arrivalAtMs")
      previous = departure
      val original = plan.segments.getOrNull(i)
      LiveSegment(leg.getString("mode"), leg.optString("line"), original?.color ?: plan.accentColor,
        departure, max(departure, arrival),
        leg.optDouble("toLat").takeIf { it.isFinite() }, leg.optDouble("toLon").takeIf { it.isFinite() })
    }
    val end = max(segments.lastOrNull()?.endAtMs ?: plan.endAtMs,
      (state.optLong("arrivalAtMs") + 60_000).takeIf { state.optString("status") != "complete" } ?: 0)
    val status = state.optString("status")
    val complete = status == "complete"
    val copy = PhaseCopy(state.optString("notificationTitle"), state.optString("notificationText"),
      state.optString("transferStop"))
    val riding = state.has("arrivalAtMs")
    val phase = if (riding) LiveTripPlan.PHASE_RIDING else LiveTripPlan.PHASE_WAITING
    return plan.copy(
      segments = segments, endAtMs = end,
      stopAfterMs = if (complete) end + 180_000 else state.optLong("validUntilMs", end + 180_000),
      delayMin = state.optInt("delaySec") / 60,
      protectedLegIndex = active.takeIf { state.has("arrivalAtMs") },
      states = if (complete || copy.title.isBlank()) emptyList() else listOf(LiveState(
        now, phase, if (riding) state.optLong("arrivalAtMs") else plan.countdownAtMs,
        plan.accentColor, copy)),
    )
  }

  fun alert(context: Context, plan: LiveTripPlan, state: JSONObject) {
    val title = state.optString("notificationTitle")
    val text = state.optString("notificationText")
    if (title.isBlank() || text.isBlank()) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, state.optString("channelName"),
        NotificationManager.IMPORTANCE_HIGH).apply { enableVibration(false) })
    }
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(plan.deepLink)).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val open = PendingIntent.getActivity(context, ALERT_ID, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    try {
      NotificationManagerCompat.from(context).notify(ALERT_ID,
        NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_kilometr_tram)
          .setContentTitle(title).setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
          .setPriority(NotificationCompat.PRIORITY_HIGH).setCategory(NotificationCompat.CATEGORY_NAVIGATION)
          .setAutoCancel(true).setContentIntent(open).build())
      TripVibrator.alight(context)
    } catch (_: SecurityException) { }
  }

  fun cancel(context: Context) = NotificationManagerCompat.from(context).cancel(ALERT_ID)

  private fun clockSec(value: String): Int {
    val parts = value.split(":")
    return (parts.getOrNull(0)?.toIntOrNull() ?: 0) * 3600 + (parts.getOrNull(1)?.toIntOrNull() ?: 0) * 60
  }
}
