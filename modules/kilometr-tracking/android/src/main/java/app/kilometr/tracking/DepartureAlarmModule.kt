package app.kilometr.tracking

import android.app.AlarmManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class DepartureAlarmModule : Module() {
  private val context: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("KilometrAlarm")

    AsyncFunction("getAlarm") { context?.let { DepartureAlarmStore.read(it)?.toString() } }

    AsyncFunction("getPermissions") {
      val ctx = context ?: return@AsyncFunction emptyMap<String, Boolean>()
      val manager = ctx.getSystemService(NotificationManager::class.java)
      mapOf(
        "notifications" to NotificationManagerCompat.from(ctx).areNotificationsEnabled(),
        "exact" to (Build.VERSION.SDK_INT < 31 || ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()),
        "fullScreen" to (Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()),
        "channel" to (Build.VERSION.SDK_INT < 26 || manager.getNotificationChannel(DepartureAlarmService.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE),
      )
    }

    AsyncFunction("openPermission") { kind: String ->
      val ctx = context ?: return@AsyncFunction false
      val intent = when {
        kind == "exact" && Build.VERSION.SDK_INT >= 31 ->
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${ctx.packageName}"))
        kind == "fullScreen" && Build.VERSION.SDK_INT >= 34 ->
          Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}"))
        kind == "channel" && Build.VERSION.SDK_INT >= 26 ->
          Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
            .putExtra(Settings.EXTRA_CHANNEL_ID, DepartureAlarmService.CHANNEL)
        else -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
      }
      try {
        ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      } catch (_: Exception) { false }
    }

    AsyncFunction("schedule") { json: String -> context?.let { DepartureAlarmStore.schedule(it, json) } ?: false }
    AsyncFunction("cancel") { context?.let { DepartureAlarmStore.cancel(it) }; true }

    AsyncFunction("preview") { json: String ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      activity.startActivity(Intent(activity, DepartureAlarmActivity::class.java)
        .putExtra("preview", json))
      true
    }.runOnQueue(Queues.MAIN)
  }
}
