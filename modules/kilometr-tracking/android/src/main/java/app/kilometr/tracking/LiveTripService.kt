package app.kilometr.tracking

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/** Powiadomienie i alert GPS działają bez aktywnego JS, także przy wygaszonym ekranie. */
class LiveTripService : Service() {

  private val handler = Handler(Looper.getMainLooper())

  private var plan: LiveTripPlan? = null
  private var lastSignature: String? = null

  private val alightProximity = AlightProximity()
  private val locationManager by lazy { getSystemService(LocationManager::class.java) }
  private var locationForeground = false
  private var locationSubscribed = false
  private val locationListener = object : LocationListener {
    override fun onLocationChanged(location: Location) {
      val current = plan ?: return
      maybeVibrateAlight(current, location)
    }
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
    @Deprecated("Required on Android before API 30")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
  }

  private val tick = object : Runnable {
    override fun run() {
      val current = plan
      if (current == null) {
        shutdown()
        return
      }
      val now = System.currentTimeMillis()
      if (current.isExpired(now)) {
        TripAlerts.cancel(this@LiveTripService)
        shutdown()
        return
      }

      val phase = current.phaseAt(now)
      // Renderujemy tylko po zmianie fazy, treści albo postępu.
      val signature = "$phase:${current.stateAt(now)?.atMs}:${current.progressPermille(now)}"
      if (signature != lastSignature) {
        lastSignature = signature
        if (!publish(current, now)) return
      }
      updateLocationSubscription()

      handler.postDelayed(
        this,
        if (phase == LiveTripPlan.PHASE_RIDING) TICK_RIDING_MS else TICK_IDLE_MS,
      )
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      shutdown()
      return START_NOT_STICKY
    }

    val json = intent?.getStringExtra(EXTRA_PLAN)
    if (!json.isNullOrBlank()) {
      LiveTripPlan.fromJson(json)?.let {
        if (plan?.tripId != it.tripId) alightProximity.clear()
        plan = it
        // Nowy plan unieważnia podpis — inaczej pierwsza klatka po starcie
        // zostałaby wstrzymana jako „bez zmian".
        lastSignature = null
      }
    }

    val current = plan
    if (current == null) {
      shutdown()
      return START_NOT_STICKY
    }

    if (current.isExpired(System.currentTimeMillis()) || LocalStopSignal.isPending(this)) {
      shutdown()
      return START_NOT_STICKY
    }

    isRunning = true
    // startForeground musi zadziałać w ciągu 5 s od startForegroundService,
    // więc renderujemy natychmiast, a dopiero potem wchodzi pętla.
    if (!publish(current, System.currentTimeMillis(), tryLocation = true)) {
      // Bez działającego FGS nie ma po co żyć: publish() już zatrzymał usługę.
      return START_NOT_STICKY
    }
    updateLocationSubscription()

    handler.removeCallbacks(tick)
    handler.postDelayed(tick, TICK_IDLE_MS)
    // REDELIVER: proces może zostać ubity w trakcie podróży. Bez tego
    // Android odtworzyłby pustą usługę bez planu i powiadomienie zniknęłoby.
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    stopLocationUpdates()
    plan = null
    isRunning = false
    super.onDestroy()
  }

  private fun maybeVibrateAlight(current: LiveTripPlan, location: Location) {
    val nowMs = System.currentTimeMillis()
    if (!current.alightAlertsEnabled || current.isExpired(nowMs) || !location.hasAccuracy()) return
    val active = current.alightSegmentAt(nowMs) ?: return
    val segment = active.value
    val lat = segment.alightLat ?: return
    val lon = segment.alightLon ?: return
    val distance = FloatArray(1)
    Location.distanceBetween(location.latitude, location.longitude, lat, lon, distance)
    val ageMs = (SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos) / 1_000_000L
    if (alightProximity.shouldAlert(
        "${active.index}:${segment.line}", distance[0], location.accuracy, ageMs,
      )) {
      TripVibrator.alight(this)
      stopLocationUpdates()
    }
  }

  private fun hasPreciseLocation(): Boolean =
    ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
      PackageManager.PERMISSION_GRANTED

  private fun updateLocationSubscription() {
    val active = plan?.alightSegmentAt(System.currentTimeMillis())
    if (
      !locationForeground || !hasPreciseLocation() || active == null ||
      active.value.alightLat == null || active.value.alightLon == null ||
      alightProximity.hasAlerted("${active.index}:${active.value.line}")
    ) {
      stopLocationUpdates()
      return
    }
    if (locationSubscribed) return
    for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
      try {
        if (provider !in locationManager.allProviders) continue
        locationManager.requestLocationUpdates(
          provider, 1_000L, 0f, locationListener, Looper.getMainLooper(),
        )
        locationSubscribed = true
      } catch (_: SecurityException) {
        stopLocationUpdates()
        return
      } catch (_: IllegalArgumentException) {
        // Dostawca lokalizacji może zniknąć między sprawdzeniem a subskrypcją.
      }
    }
  }

  private fun stopLocationUpdates() {
    if (locationSubscribed) {
      locationManager.removeUpdates(locationListener)
      locationSubscribed = false
    }
  }

  /** Render i publikacja. Zawsze przez startForeground, żeby FGS żyło dalej.
   *  Zwraca false, gdy startForeground się nie powiódł (usługa została wtedy
   *  zatrzymana, bo bez FGS system ubija proces po 5 s). */
  private fun publish(current: LiveTripPlan, nowMs: Long, tryLocation: Boolean = false): Boolean {
    val notification = LiveUpdateFactory.build(this, current, nowMs)
    val wantsLocation = current.alightAlertsEnabled && hasPreciseLocation() &&
      current.segments.any {
        it.mode != LiveTripPlan.MODE_WALK && it.alightLat != null && it.alightLon != null
      }
    var useLocation = wantsLocation && (locationForeground || tryLocation)
    val baseType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
    } else 0
    fun promote() {
      val type = if (useLocation && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        baseType or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      } else baseType
      ServiceCompat.startForeground(this, LiveUpdateFactory.NOTIFICATION_ID, notification, type)
    }
    try {
      try {
        promote()
      } catch (error: SecurityException) {
        if (!useLocation) throw error
        // Odtworzenie z tła może nie mieć dostępu do zgody „podczas używania”.
        useLocation = false
        promote()
      }
      locationForeground = useLocation
      if (!useLocation) stopLocationUpdates()
      return true
    } catch (_: Throwable) {
      // Android 12+ blokuje start FGS z tła. Pokazujemy zwykłe powiadomienie,
      // ale usługa MUSI się zatrzymać: gdy startForeground nigdy nie zadziała,
      // system i tak ubija proces wyjątkiem ForegroundServiceDidNotStartInTimeException.
      try {
        NotificationManagerCompat.from(this).notify(LiveUpdateFactory.NOTIFICATION_ID, notification)
      } catch (_: Throwable) {
        // brak POST_NOTIFICATIONS — JS dostało wtedy false przy starcie
      }
      shutdown()
      return false
    }
  }

  private fun shutdown() {
    handler.removeCallbacks(tick)
    stopLocationUpdates()
    locationForeground = false
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    } catch (_: Throwable) {
      // serwis mógł już nie być w pierwszym planie
    }
    plan = null
    lastSignature = null
    alightProximity.clear()
    isRunning = false
    stopSelf()
  }

  companion object {
    const val ACTION_START = "app.kilometr.tracking.START"
    const val ACTION_STOP = "app.kilometr.tracking.STOP"
    const val EXTRA_PLAN = "plan"

    /** 1 Hz w trasie — pasek postępu ma płynąć tak jak w nawigacji. */
    private const val TICK_RIDING_MS = 1_000L

    /** Poza trasą licznik odlicza system, więc JS-owy render nie jest potrzebny. */
    private const val TICK_IDLE_MS = 15_000L

    @Volatile
    var isRunning: Boolean = false
      private set

    fun planIntent(context: Context, json: String): Intent =
      Intent(context, LiveTripService::class.java).apply {
        action = ACTION_START
        putExtra(EXTRA_PLAN, json)
      }
  }
}
