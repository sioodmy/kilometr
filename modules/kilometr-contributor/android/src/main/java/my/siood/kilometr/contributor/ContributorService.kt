package my.siood.kilometr.contributor

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter
import kotlin.math.abs
import kotlin.math.sqrt
import java.util.UUID

/**
 * Serwis telemetrii Contributor: GPS + akcelerometr, jedna próbka JSONL na
 * sekundę, zapisywana do pliku w prywatnym katalogu aplikacji.
 *
 * Powód istnienia jest ten sam co dla LiveTripService: zbieranie ma przeżyć
 * zamknięcie aplikacji i zablokowany ekran, więc JS nie może być
 * synchronizatorem próbkowania - ale nie żyje z niego Live Update. Powia-
 * domianie ma stały tekst od JS (w [EXTRA_META]), a serwis tylko pisze do
 * pliku. Przy powrocie do aplikacji ingest przenosi go do SQLite.
 *
 * Plik `<sessionId>.jsonl`:
 *  1. linia: `{kind:"session", schema:1, id, deviceId, startedAt, ...meta}`
 *  dalej: `{t, lat, ..., a:[min,max,avg,std], xyz:[x,y,z], moved}`
 */
class ContributorService : Service(), SensorEventListener, LocationListener {

  private val handler = Handler(Looper.getMainLooper())

  private var locationManager: LocationManager? = null
  private var sensorManager: SensorManager? = null
  private var writer: OutputStreamWriter? = null

  /** Meta sesji (deviceId, linia, kurs, teksty powiadomienia) z JSON od JS. */
  private var meta: JSONObject? = null
  private var sessionId: String? = null
  private var startedAt: Long = 0

  // Akcelerometr: bufor surowych odczytów (m/s^2), zamiata flush co sekundę.
  private val accelX = mutableListOf<Float>()
  private val accelY = mutableListOf<Float>()
  private val accelZ = mutableListOf<Float>()
  private var lastWrittenMagAvg = 0f

  /** Ostatni fix - trzymamy jego świeżość bez historii. */
  private var lastLocation: Location? = null

  private val flush = object : Runnable {
    override fun run() {
      try {
        appendSample()
      } catch (_: Throwable) {
        // problemy z IO (pełny dysk) nie mogą zabić serwisu-
        // kolejna sekunda spróbuje zapisu od nowa
      }
      handler.postDelayed(this, FLUSH_MS)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun hasLocationPermission(): Boolean {
    return ContextCompat.checkSelfPermission(
      this,
      Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      shutdown()
      return START_NOT_STICKY
    }
    val raw = intent?.getStringExtra(EXTRA_META)
    val parsed = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
    if (parsed == null || isRunning) return START_NOT_STICKY

    if (!hasLocationPermission()) {
      // Bez uprawnień nie ma się czym wypełnić - nie walczymy o FGS.
      shutdown()
      return START_NOT_STICKY
    }

    if (!startForegroundSafe(parsed)) {
      shutdown()
      return START_NOT_STICKY
    }

    meta = parsed
    sessionId = newSessionId()
    startedAt = System.currentTimeMillis()
    isRunning = true

    openWriter()
    writeHeader()
    registerCollectors()

    handler.removeCallbacks(flush)
    handler.postDelayed(flush, FLUSH_MS)
    // REDELIVER: sesja testera nie może umrzeć razem z procesem.
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    handler.removeCallbacks(flush)
    unregisterCollectors()
    closeWriter()
    isRunning = false
    super.onDestroy()
  }

  private fun startForegroundSafe(parsed: JSONObject): Boolean {
    return try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification(parsed),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        } else {
          0
        },
      )
      true
    } catch (_: Throwable) {
      false
    }
  }

  private fun buildNotification(parsed: JSONObject): Notification {
    val channel = ensureContributorChannel(
      this,
      // Nazwa i opis kanału przychodzą z JS przetłumaczone (jak w LiveTripPlan).
      channelName = parsed.optString("channelName", parsed.optString("title", "Kilometr Contributor")),
      channelDescription = parsed.optString("channelDescription", ""),
    )
    return NotificationCompat.Builder(this, channel)
      .setSmallIcon(R.drawable.ic_kilometr_tram)
      .setContentTitle(parsed.optString("title", ""))
      .setContentText(parsed.optString("text", ""))
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  private fun registerCollectors() {
    val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    locationManager = lm
    if (lm != null && hasLocationPermission()) {
      try {
        lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, FLUSH_MS, 0f, this)
      } catch (_: Throwable) {
        // GPS wyłączony systemowo - próbki pójdą z samego akcelerometru
      }
      try {
        lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, FLUSH_MS, 0f, this)
      } catch (_: Throwable) {
        // sieciowy fix równie mocno opcjonalny
      }
    }

    val sm = getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    sensorManager = sm
    val accelSensor = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    if (accelSensor != null) {
      try {
        // GAME ≈ 50 Hz - ta sama gęstość, co w buforach JS.
        sm.registerListener(this, accelSensor, SensorManager.SENSOR_DELAY_GAME)
      } catch (_: Throwable) {
        // wyjście z rejestracji nie skraca życia serwisu
      }
    }
  }

  private fun unregisterCollectors() {
    locationManager?.removeUpdates(this)
    locationManager = null
    sensorManager?.unregisterListener(this)
    sensorManager = null
  }

  private fun outFile(context: Context, id: String): File {
    val dir = File(context.filesDir, "contributor")
    if (!dir.exists()) dir.mkdirs()
    return File(dir, "$id.jsonl")
  }

  private fun openWriter() {
    val id = sessionId ?: return
    writer = OutputStreamWriter(FileOutputStream(outFile(this, id), false), Charsets.UTF_8)
  }

  private fun closeWriter() {
    try {
      writer?.flush()
    } catch (_: Throwable) {
      // brak flush trafia do close i tak
    }
    try {
      writer?.close()
    } catch (_: Throwable) {
    }
    writer = null
  }

  private fun writeHeader() {
    val id = sessionId ?: return
    val m = meta ?: return
    val header = JSONObject()
      .put("kind", "session")
      .put("schema", 1)
      .put("id", id)
      .put("deviceId", m.optString("deviceId"))
      .put("startedAt", startedAt)
      .put("endedAt", JSONObject.NULL)
      .put("source", m.optString("source", "manual"))
      .put("city", m.optString("city", ""))
      .put("line", m.optString("line", ""))
      .put("routeId", m.optString("routeId", ""))
      .put("tripId", m.optString("tripId", ""))
      .put("headsign", m.optString("headsign", ""))
      .put("fromTitle", m.optString("fromTitle", ""))
      .put("toTitle", m.optString("toTitle", ""))
      .put("delayMin", if (m.has("delayMin") && !m.isNull("delayMin")) m.get("delayMin") else JSONObject.NULL)
    safeWrite(header.toString())
  }

  /** Jedna sekunda buforów zamknięta w jeden wiersz JSONL (ten sam kształt co JS). */
  private fun appendSample() {
    if (accelX.isEmpty()) return
    val mag = magnitude(accelX, accelY, accelZ)
    if (mag == null) return

    val deltaMag = abs(mag.avg - lastWrittenMagAvg)
    val loc = lastLocation
    val moved = deltaMag > MOVE_THRESHOLD || (loc?.speed ?: 0f) > SPEED_THRESHOLD

    val row = JSONObject()
      .put("t", System.currentTimeMillis())
      .put("lat", loc?.latitude ?: JSONObject.NULL)
      .put("lng", loc?.longitude ?: JSONObject.NULL)
      .put("alt", loc?.altitude ?: JSONObject.NULL)
      .put("hacc", loc?.accuracy?.toDouble() ?: JSONObject.NULL)
      .put("spd", loc?.speed?.toDouble() ?: JSONObject.NULL)
      .put("brg", loc?.bearing?.toDouble() ?: JSONObject.NULL)
      .put(
        "a", org.json.JSONArray()
          .put(mag.min)
          .put(mag.max)
          .put(mag.avg)
          .put(mag.std),
      )
      .put(
        "xyz", org.json.JSONArray()
          .put(mag.xAvg)
          .put(mag.yAvg)
          .put(mag.zAvg),
      )
      .put("moved", moved)
    safeWrite(row.toString())

    lastWrittenMagAvg = mag.avg
    accelX.clear()
    accelY.clear()
    accelZ.clear()
  }

  private fun safeWrite(line: String) {
    val w = writer ?: return
    w.write(line)
    w.write("\n")
    w.flush()
  }

  private fun magnitude(
    xs: List<Float>,
    ys: List<Float>,
    zs: List<Float>,
  ): MagBatch? {
    val n = xs.size
    if (n == 0 || ys.size != n || zs.size != n) return null
    var minMag = Float.MAX_VALUE
    var maxMag = -Float.MAX_VALUE
    var sumMag = 0f
    var sumSq = 0f
    var sumX = 0f
    var sumY = 0f
    var sumZ = 0f
    for (i in 0 until n) {
      val x = xs[i]
      val y = ys[i]
      val z = zs[i]
      val m = sqrt((x * x + y * y + z * z).toDouble()).toFloat()
      if (m < minMag) minMag = m
      if (m > maxMag) maxMag = m
      sumMag += m
      sumSq += m * m
      sumX += x
      sumY += y
      sumZ += z
    }
    val avg = sumMag / n
    val std = sqrt(((sumSq / n) - avg * avg).toDouble()).toFloat()
    return MagBatch(
      min = minMag,
      max = maxMag,
      avg = avg,
      std = std,
      xAvg = sumX / n,
      yAvg = sumY / n,
      zAvg = sumZ / n,
    )
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return
    val v = event.values
    if (v.size < 3) return
    if (accelX.size >= MAX_SAMPLES_PER_FLUSH) return
    accelX.add(v[0])
    accelY.add(v[1])
    accelZ.add(v[2])
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
    // akcelerometr nie potrzebuje reakcji na dokładność
  }

  override fun onLocationChanged(location: Location) {
    lastLocation = location
  }

  @Deprecated("Deprecated in Java")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}

  override fun onProviderEnabled(provider: String) {
    // fix wraca sam: requestLocationUpdates pozostaje aktywne
  }

  override fun onProviderDisabled(provider: String) {
    // system informuje, ale nie zdejmujemy nasłuchu GPS
  }

  private fun shutdown() {
    handler.removeCallbacks(flush)
    unregisterCollectors()
    closeWriter()
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    } catch (_: Throwable) {
      // serwis mógł już nie być w pierwszym planie
    }
    meta = null
    sessionId = null
    isRunning = false
    stopSelf()
  }

  /** Jedna porcja 1 s próbek: statystyki magnitude i średnie osi. */
  private data class MagBatch(
    val min: Float,
    val max: Float,
    val avg: Float,
    val std: Float,
    val xAvg: Float,
    val yAvg: Float,
    val zAvg: Float,
  )

  companion object {
    const val ACTION_START = "my.siood.kilometr.contributor.CONTRIBUTOR_START"
    const val ACTION_STOP = "my.siood.kilometr.contributor.CONTRIBUTOR_STOP"
    const val EXTRA_META = "meta"

    private const val NOTIFICATION_ID = 9091
    private const val CHANNEL_ID = "kilometr.contributor"

    private const val FLUSH_MS = 1_000L

    /** Zapas buforów: 50 Hz * 2 s - flush and tak czyści co 1 s. */
    private const val MAX_SAMPLES_PER_FLUSH = 120

    /** Skok średniej magnitude dla ruchu (zwany w JS MOVE_THRESHOLD). */
    private const val MOVE_THRESHOLD = 1.2f

    /** Speed ponad ten poziom traktowany jako „w drodze” (jak w JS). */
    private const val SPEED_THRESHOLD = 0.3f

    @Volatile
    var isRunning: Boolean = false
      private set

    fun start(context: Context, metaJson: String): Boolean {
      if (isRunning) return true
      val intent = Intent(context, ContributorService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_META, metaJson)
      }
      return try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (_: Throwable) {
        false
      }
    }

    fun stop(context: Context): Boolean {
      val intent = Intent(context, ContributorService::class.java).apply {
        action = ACTION_STOP
      }
      return try {
        // Serwis stoi w pierwszym planie, więc zwykły startService z akcją
        // STOP jest legalny (nie tworzy nowego wymogu startForeground).
        context.startService(intent)
        true
      } catch (_: Throwable) {
        false
      }
    }

    fun ensureContributorChannel(context: Context, channelName: String, channelDescription: String): String {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return CHANNEL_ID
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      if (manager != null && manager.getNotificationChannel(CHANNEL_ID) == null && channelName.isNotBlank()) {
        val channel = NotificationChannel(CHANNEL_ID, channelName, NotificationManager.IMPORTANCE_LOW)
        channel.setSound(null, null)
        channel.setShowBadge(false)
        if (channelDescription.isNotBlank()) channel.description = channelDescription
        manager.createNotificationChannel(channel)
      }
      return CHANNEL_ID
    }

    private fun newSessionId(): String {
      // Krótkie: id wędruje do nazwy pliku i do nagłówka JSONL
      return System.currentTimeMillis().toString(36) + "-" + UUID.randomUUID().toString().substring(0, 6)
    }
  }
}
