package com.anonymous.kilometr.tracking

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat

/**
 * Serwis, który naprawdę śledzi podróż.
 *
 * Powiadomienie aktualizowane z JS umiera razem z aplikacją: po odejściu od
 * ekranu proces jest throttlowany, a po ubiciu — w ogóle. Stąd ten serwis.
 * Trzyma plan podróży, sam przelicza fazę i postęp (czyste działania na
 * zeglem) i sam przestaje, kiedy podróż się skończy. JS odpowiada tylko za
 * dostarczenie treści i za dane z planera.
 *
 * Render korzysta z `Notification.ProgressStyle` (Android 16), a typ usługi
 * to `specialUse` — śledzenie podróży użytkownika nie mieści się w żadnej
 * z typów „lokalizacja / telefon / kamera", a dokumentacja Androida wprost
 * wskazuje śledzenie przejazdu jako przykład `specialUse`.
 */
class LiveTripService : Service() {

  private val handler = Handler(Looper.getMainLooper())

  private var plan: LiveTripPlan? = null
  private var lastSignature: String? = null

  private val tick = object : Runnable {
    override fun run() {
      val current = plan
      if (current == null) {
        shutdown()
        return
      }
      val now = System.currentTimeMillis()
      if (current.isExpired(now)) {
        shutdown()
        return
      }

      val phase = current.phaseAt(now)
      // Publikujemy tylko wtedy, gdy zmienia się coś widocznego. Pasek
      // postępu rusza się sekundowo, ale tekst nie, więc przed dojazdem
      // (gdzie postęp praktycznie stoi) budzimy się raz na kwadrans.
      val signature = "$phase:${current.progressPermille(now)}"
      if (signature != lastSignature) {
        lastSignature = signature
        publish(current, now)
      }

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

    isRunning = true
    // startForeground musi zadziałać w ciągu 5 s od startForegroundService,
    // więc renderujemy natychmiast, a dopiero potem wchodzi pętla.
    if (!publish(current, System.currentTimeMillis())) {
      // Bez działającego FGS nie ma po co żyć: publish() już zatrzymał usługę.
      return START_NOT_STICKY
    }

    handler.removeCallbacks(tick)
    handler.postDelayed(tick, TICK_IDLE_MS)
    // REDELIVER: proces może zostać ubity w trakcie podróży. Bez tego
    // Android odtworzyłby pustą usługę bez planu i powiadomienie zniknęłoby.
    return START_REDELIVER_INTENT
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    plan = null
    isRunning = false
    super.onDestroy()
  }

  /** Render i publikacja. Zawsze przez startForeground, żeby FGS żyło dalej.
   *  Zwraca false, gdy startForeground się nie powiódł (usługa została wtedy
   *  zatrzymana, bo bez FGS system ubija proces po 5 s). */
  private fun publish(current: LiveTripPlan, nowMs: Long): Boolean {
    val notification = LiveUpdateFactory.build(this, current, nowMs)
    try {
      ServiceCompat.startForeground(
        this,
        LiveUpdateFactory.NOTIFICATION_ID,
        notification,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
          0
        },
      )
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
    try {
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    } catch (_: Throwable) {
      // serwis mógł już nie być w pierwszym planie
    }
    plan = null
    lastSignature = null
    isRunning = false
    stopSelf()
  }

  companion object {
    const val ACTION_START = "com.anonymous.kilometr.tracking.START"
    const val ACTION_STOP = "com.anonymous.kilometr.tracking.STOP"
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