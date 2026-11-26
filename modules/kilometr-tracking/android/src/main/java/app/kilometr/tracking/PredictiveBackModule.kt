package app.kilometr.tracking

import android.app.Activity
import android.os.Build
import android.window.BackEvent
import android.window.OnBackAnimationCallback
import android.window.OnBackInvokedDispatcher
import androidx.annotation.RequiresApi
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import kotlin.math.abs

/**
 * Mostek natywnego Android Predictive Back (API 34+) do JS/Reanimated.
 *
 * Rejestruje OnBackAnimationCallback z PRIORITY_OVERLAY wyłącznie wtedy, gdy
 * aktywny ekran (np. szczegóły połączenia) włączy przechwytywanie. Po wyrejestrowaniu
 * zdarzenia wracają natychmiast do standardowego BackHandlera React Native.
 */
class PredictiveBackModule : Module() {

  @Volatile
  private var desiredEnabled = false

  private var registeredActivityRef: WeakReference<Activity>? = null
  private var registeredCallback: Any? = null

  private var lastProgress = -1f
  private var lastTouchYDp = Float.NaN
  private var lastSwipeEdge = -1

  override fun definition() = ModuleDefinition {
    Name("KilometrPredictiveBack")

    Events("onBackStarted", "onBackProgressed", "onBackInvoked", "onBackCancelled")

    Function("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
    }

    Function("setEnabled") { enabled: Boolean ->
      desiredEnabled = enabled
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        return@Function false
      }
      val activity = appContext.currentActivity ?: registeredActivityRef?.get()
      if (activity == null) {
        return@Function false
      }
      activity.runOnUiThread {
        if (desiredEnabled) {
          registerIfNeeded(activity)
        } else {
          unregisterCurrent()
        }
      }
      true
    }

    OnActivityEntersForeground {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE && desiredEnabled) {
        appContext.currentActivity?.let { activity ->
          activity.runOnUiThread {
            if (desiredEnabled) registerIfNeeded(activity)
          }
        }
      }
    }

    OnActivityDestroys {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        unregisterCurrent()
      }
    }

    OnDestroy {
      desiredEnabled = false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val activity = registeredActivityRef?.get()
        if (activity != null) {
          activity.runOnUiThread { unregisterCurrent() }
        } else {
          registeredCallback = null
          registeredActivityRef = null
        }
      }
    }
  }

  @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  private fun registerIfNeeded(activity: Activity) {
    if (activity.isFinishing || activity.isDestroyed) return
    val current = registeredActivityRef?.get()
    if (current === activity && registeredCallback != null) return
    if (registeredCallback != null) {
      unregisterCurrent()
    }
    val density = activity.resources.displayMetrics.density.let { if (it > 0f) it else 1f }
    val callback = createAnimationCallback(density)
    try {
      activity.onBackInvokedDispatcher.registerOnBackInvokedCallback(
        OnBackInvokedDispatcher.PRIORITY_OVERLAY,
        callback,
      )
      registeredActivityRef = WeakReference(activity)
      registeredCallback = callback
    } catch (_: Throwable) {
      registeredActivityRef = null
      registeredCallback = null
    }
  }

  @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  private fun unregisterCurrent() {
    val callback = registeredCallback as? OnBackAnimationCallback
    val activity = registeredActivityRef?.get()
    registeredCallback = null
    registeredActivityRef = null
    resetDedupe()
    if (callback != null && activity != null && !activity.isDestroyed) {
      try {
        activity.onBackInvokedDispatcher.unregisterOnBackInvokedCallback(callback)
      } catch (_: Throwable) {
        // Aktywność mogła już odpiąć dispatcher w trakcie zamykania okna.
      }
    }
  }

  private fun resetDedupe() {
    lastProgress = -1f
    lastTouchYDp = Float.NaN
    lastSwipeEdge = -1
  }

  @RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  private fun createAnimationCallback(density: Float): OnBackAnimationCallback =
    object : OnBackAnimationCallback {
      override fun onBackStarted(backEvent: BackEvent) {
        val progress = backEvent.progress
        val touchXDp = backEvent.touchX / density
        val touchYDp = backEvent.touchY / density
        val swipeEdge = backEvent.swipeEdge
        lastProgress = progress
        lastTouchYDp = touchYDp
        lastSwipeEdge = swipeEdge
        emitSafe(
          "onBackStarted",
          mapOf(
            "progress" to progress.toDouble(),
            "touchX" to touchXDp.toDouble(),
            "touchY" to touchYDp.toDouble(),
            "swipeEdge" to swipeEdge,
          ),
        )
      }

      override fun onBackProgressed(backEvent: BackEvent) {
        val progress = backEvent.progress
        val touchXDp = backEvent.touchX / density
        val touchYDp = backEvent.touchY / density
        val swipeEdge = backEvent.swipeEdge
        // Pomijamy identyczne klatki przy zatrzymanym palcu, by nie obciążać wątku JS.
        if (
          swipeEdge == lastSwipeEdge &&
          abs(progress - lastProgress) < 0.001f &&
          !lastTouchYDp.isNaN() &&
          abs(touchYDp - lastTouchYDp) < 0.5f
        ) {
          return
        }
        lastProgress = progress
        lastTouchYDp = touchYDp
        lastSwipeEdge = swipeEdge
        emitSafe(
          "onBackProgressed",
          mapOf(
            "progress" to progress.toDouble(),
            "touchX" to touchXDp.toDouble(),
            "touchY" to touchYDp.toDouble(),
            "swipeEdge" to swipeEdge,
          ),
        )
      }

      override fun onBackInvoked() {
        resetDedupe()
        emitSafe("onBackInvoked", emptyMap())
      }

      override fun onBackCancelled() {
        resetDedupe()
        emitSafe("onBackCancelled", emptyMap())
      }
    }

  private fun emitSafe(name: String, payload: Map<String, Any>) {
    try {
      sendEvent(name, payload)
    } catch (_: Throwable) {
      // Ignorujemy zdarzenia wysłane podczas restartu kontekstu JS.
    }
  }
}
