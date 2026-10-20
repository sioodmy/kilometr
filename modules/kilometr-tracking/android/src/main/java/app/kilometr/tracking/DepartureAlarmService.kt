package app.kilometr.tracking

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.core.app.NotificationCompat
import org.json.JSONObject

class DepartureAlarmService : Service() {
  companion object {
    const val CHANNEL = "kilometr.alarm"
    private const val ID = 4202
    fun ensureChannel(context: Context, labels: JSONObject) {
      if (Build.VERSION.SDK_INT < 26) return
      context.getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL, labels.getString("channel"), NotificationManager.IMPORTANCE_HIGH).apply {
          description = labels.getString("channelDescription")
          lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
          setSound(null, null)
          enableVibration(false)
        },
      )
    }
  }

  private val handler = Handler(Looper.getMainLooper())
  private val timeout = Runnable { DepartureAlarmStore.cancel(this) }
  private var player: MediaPlayer? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var focus: AudioFocusRequest? = null
  private val audio by lazy { getSystemService(AudioManager::class.java) }
  private val vibrator by lazy { getSystemService(Vibrator::class.java) }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val data = DepartureAlarmStore.read(this)
    if (data == null || data.optString("status") != "ringing") {
      stopSelf()
      return START_NOT_STICKY
    }
    val labels = data.getJSONObject("labels")
    ensureChannel(this, labels)
    val dismiss = PendingIntent.getBroadcast(this, ID,
      Intent(this, DepartureAlarmReceiver::class.java).setAction("dismiss"),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(app.kilometr.tracking.R.drawable.ic_kilometr_alarm)
      .setContentTitle(labels.getString("ringTitle"))
      .setContentText(data.getString("routeLabel"))
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setContentIntent(DepartureAlarmStore.screenIntent(this))
      .setFullScreenIntent(DepartureAlarmStore.screenIntent(this), true)
      .addAction(0, labels.getString("dismiss"), dismiss)
      .build()
    startForeground(ID, notification)
    if (player != null) return START_NOT_STICKY
    wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:departureAlarm")
      .apply { acquire(125_000L) }
    val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    if (Build.VERSION.SDK_INT >= 26) {
      focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attributes).setOnAudioFocusChangeListener { change ->
          if (change == AudioManager.AUDIOFOCUS_LOSS) DepartureAlarmStore.cancel(this)
        }.build().also { audio.requestAudioFocus(it) }
    }
    try {
      player = MediaPlayer().apply {
        setAudioAttributes(attributes)
        setDataSource(this@DepartureAlarmService,
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION))
        isLooping = true
        prepare()
        start()
      }
    } catch (_: Exception) {
      player?.release()
      player = null
    }
    val pattern = longArrayOf(0, 450, 250, 450, 1200)
    if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), attributes)
    else @Suppress("DEPRECATION") vibrator.vibrate(pattern, 0)
    handler.removeCallbacks(timeout)
    handler.postDelayed(timeout, 120_000L)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(timeout)
    player?.release()
    player = null
    vibrator.cancel()
    if (Build.VERSION.SDK_INT >= 26) focus?.let { audio.abandonAudioFocusRequest(it) }
    if (wakeLock?.isHeld == true) wakeLock?.release()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }
}
