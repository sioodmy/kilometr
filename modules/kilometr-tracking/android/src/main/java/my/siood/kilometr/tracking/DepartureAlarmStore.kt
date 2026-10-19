package my.siood.kilometr.tracking

import android.app.ActivityOptions
import android.app.ActivityManager
import android.app.AlarmManager
import android.app.PendingIntent
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

internal object DepartureAlarmStore {
  const val CLOSE = "my.siood.kilometr.ALARM_CLOSED"
  private const val REQUEST = 4201
  private fun prefs(context: Context) = context.getSharedPreferences("departure_alarm", Context.MODE_PRIVATE)

  fun read(context: Context): JSONObject? = try {
    prefs(context).getString("alarm", null)?.let { JSONObject(it) }
  } catch (_: Exception) { null }

  private fun write(context: Context, data: JSONObject) {
    prefs(context).edit().putString("alarm", data.toString()).commit()
  }

  private fun operation(context: Context, at: Long = 0L): PendingIntent = PendingIntent.getBroadcast(
    context, REQUEST, Intent(context, DepartureAlarmReceiver::class.java).setAction("fire").putExtra("at", at),
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )

  fun screenIntent(context: Context): PendingIntent {
    val options = ActivityOptions.makeBasic()
    if (Build.VERSION.SDK_INT >= 35) {
      options.setPendingIntentCreatorBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
    }
    return PendingIntent.getActivity(context, REQUEST,
      Intent(context, DepartureAlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE, options.toBundle())
  }

  fun routeIntent(context: Context, data: JSONObject): Intent = Intent(Intent.ACTION_VIEW,
    Uri.parse("kilometr://routes/${Uri.encode(data.getString("connectionId"))}"))
    .setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

  @Synchronized
  fun schedule(context: Context, json: String): Boolean {
    return try {
      val data = JSONObject(json)
      val at = data.getLong("at")
      if (at <= System.currentTimeMillis()) return false
      data.getJSONObject("labels")
      data.getJSONObject("colors")
      data.getString("connectionId")
      val manager = context.getSystemService(AlarmManager::class.java)
      if (Build.VERSION.SDK_INT >= 31 && !manager.canScheduleExactAlarms()) return false
      DepartureAlarmService.ensureChannel(context, data.getJSONObject("labels"))
      val notifications = context.getSystemService(NotificationManager::class.java)
      if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
      if (Build.VERSION.SDK_INT >= 34 && !notifications.canUseFullScreenIntent()) return false
      if (Build.VERSION.SDK_INT >= 26 && notifications.getNotificationChannel(DepartureAlarmService.CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return false
      val show = PendingIntent.getActivity(context, REQUEST + 1, routeIntent(context, data),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      manager.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), operation(context, at))
      context.stopService(Intent(context, DepartureAlarmService::class.java))
      context.sendBroadcast(Intent(CLOSE).setPackage(context.packageName))
      write(context, data.put("status", "scheduled"))
      true
    } catch (_: Exception) { false }
  }

  @Synchronized
  fun cancel(context: Context) {
    context.getSystemService(AlarmManager::class.java).cancel(operation(context))
    read(context)?.let { write(context, it.put("status", "dismissed")) }
    context.stopService(Intent(context, DepartureAlarmService::class.java))
    context.sendBroadcast(Intent(CLOSE).setPackage(context.packageName))
  }

  @Synchronized
  fun fire(context: Context, at: Long): Boolean {
    val data = read(context) ?: return false
    if (data.optString("status") != "scheduled" || data.optLong("at") != at) return false
    if (System.currentTimeMillis() - at > 5 * 60_000) {
      write(context, data.put("status", "dismissed"))
      return false
    }
    write(context, data.put("status", "ringing"))
    return true
  }
}

class DepartureAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "dismiss") {
      DepartureAlarmStore.cancel(context)
      return
    }
    if (!DepartureAlarmStore.fire(context, intent.getLongExtra("at", 0L))) return
    try {
      ContextCompat.startForegroundService(context, Intent(context, DepartureAlarmService::class.java))
      val process = ActivityManager.RunningAppProcessInfo()
      ActivityManager.getMyMemoryState(process)
      if (process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
        context.startActivity(Intent(context, DepartureAlarmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    } catch (_: Exception) {
      DepartureAlarmStore.cancel(context)
    }
  }
}

class DepartureAlarmRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
        AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED)) return
    val data = DepartureAlarmStore.read(context) ?: return
    if (data.optString("status") == "scheduled" && data.optLong("at") > System.currentTimeMillis()) {
      DepartureAlarmStore.schedule(context, data.toString())
    }
  }
}
