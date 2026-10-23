package expo.modules.location

import android.Manifest
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.location.LocationManagerCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

// Adapter API Expo używany tylko przez build F-Droid, bez usług Google.
class LocationModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val watches = mutableMapOf<Int, LocationListener>()
  private val pending = mutableMapOf<LocationListener, Pair<Promise, Runnable>>()
  private lateinit var manager: LocationManager

  override fun definition() = ModuleDefinition {
    Name("ExpoLocation")
    Events("Expo.locationChanged", "Expo.locationError")

    OnCreate {
      manager = (appContext.reactContext ?: throw Exceptions.ReactContextLost())
        .getSystemService(Context.LOCATION_SERVICE) as LocationManager
    }

    AsyncFunction("getForegroundPermissionsAsync") { promise: Promise ->
      foregroundPermissions(promise)
    }

    AsyncFunction("requestForegroundPermissionsAsync") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        appContext.permissions, object : Promise {
          override fun resolve(value: Any?) { foregroundPermissions(promise) }
          override fun reject(code: String?, message: String?, cause: Throwable?) {
            promise.reject(code, message, cause)
          }
        },
        Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION
      )
    }

    AsyncFunction("hasServicesEnabledAsync") {
      LocationManagerCompat.isLocationEnabled(manager)
    }

    AsyncFunction("getProviderStatusAsync") {
      mapOf(
        "locationServicesEnabled" to LocationManagerCompat.isLocationEnabled(manager),
        "gpsAvailable" to manager.isProviderEnabled(LocationManager.GPS_PROVIDER),
        "networkAvailable" to manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER),
        "passiveAvailable" to manager.isProviderEnabled(LocationManager.PASSIVE_PROVIDER),
        "backgroundModeEnabled" to false
      )
    }

    AsyncFunction("getLastKnownPositionAsync") { options: Map<String, Any?> ->
      val maxAge = (options["maxAge"] as? Number)?.toDouble() ?: Double.POSITIVE_INFINITY
      val accuracy = (options["requiredAccuracy"] as? Number)?.toDouble() ?: Double.POSITIVE_INFINITY
      manager.getProviders(true).mapNotNull { manager.getLastKnownLocation(it) }
        .filter { System.currentTimeMillis() - it.time <= maxAge && it.hasAccuracy() && it.accuracy <= accuracy }
        .maxByOrNull { it.time }?.let(::serialize)
    }

    AsyncFunction("getCurrentPositionAsync") { options: Map<String, Any?>, promise: Promise ->
      val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
          val request = pending.remove(this) ?: return
          handler.removeCallbacks(request.second)
          manager.removeUpdates(this)
          request.first.resolve(serialize(location))
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        @Deprecated("Android compatibility")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
      }
      val timeout = Runnable {
        pending.remove(listener)?.let {
          manager.removeUpdates(listener)
          it.first.reject("ERR_LOCATION_TIMEOUT", "Location request timed out.", null)
        }
      }
      pending[listener] = promise to timeout
      try {
        requestUpdates(options, listener)
        handler.postDelayed(timeout, 20_000)
      } catch (error: Exception) {
        pending.remove(listener)
        manager.removeUpdates(listener)
        promise.reject("ERR_LOCATION_UNAVAILABLE", error.message, error)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("watchPositionImplAsync") { watchId: Int, options: Map<String, Any?> ->
      watches.remove(watchId)?.let { manager.removeUpdates(it) }
      val listener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
          sendEvent("Expo.locationChanged", mapOf("watchId" to watchId, "location" to serialize(location)))
        }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {
          sendEvent("Expo.locationError", mapOf("watchId" to watchId, "reason" to "ERR_LOCATION_SERVICES_DISABLED"))
        }
        @Deprecated("Android compatibility")
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
      }
      try {
        requestUpdates(options, listener)
        watches[watchId] = listener
      } catch (error: Exception) {
        manager.removeUpdates(listener)
        throw error
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("removeWatchAsync") { watchId: Int ->
      watches.remove(watchId)?.let { manager.removeUpdates(it) }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      handler.post {
        watches.values.forEach { manager.removeUpdates(it) }
        watches.clear()
        pending.forEach { (listener, request) ->
          handler.removeCallbacks(request.second)
          manager.removeUpdates(listener)
          request.first.reject("ERR_LOCATION_CANCELLED", "Location module destroyed.", null)
        }
        pending.clear()
      }
    }
  }

  private fun foregroundPermissions(promise: Promise) {
    Permissions.getPermissionsWithPermissionsManager(
      appContext.permissions, object : Promise {
        override fun resolve(value: Any?) {
          val response = value as Bundle
          val accuracy = when {
            appContext.permissions?.hasGrantedPermissions(Manifest.permission.ACCESS_FINE_LOCATION) == true -> "fine"
            response.getBoolean("granted") -> "coarse"
            else -> "none"
          }
          response.putBundle("android", Bundle().apply { putString("accuracy", accuracy) })
          promise.resolve(response)
        }
        override fun reject(code: String?, message: String?, cause: Throwable?) {
          promise.reject(code, message, cause)
        }
      }, Manifest.permission.ACCESS_COARSE_LOCATION
    )
  }

  private fun requestUpdates(options: Map<String, Any?>, listener: LocationListener) {
    val precise = appContext.permissions?.hasGrantedPermissions(Manifest.permission.ACCESS_FINE_LOCATION) == true
    val providers = manager.getProviders(true).filter {
      (it == LocationManager.GPS_PROVIDER && precise) || it == LocationManager.NETWORK_PROVIDER
    }
    check(providers.isNotEmpty()) { "ERR_LOCATION_NO_PROVIDER" }
    val accuracy = (options["accuracy"] as? Number)?.toInt() ?: 3
    val selected = if (accuracy < 4 && LocationManager.NETWORK_PROVIDER in providers) {
      listOf(LocationManager.NETWORK_PROVIDER)
    } else providers
    val interval = ((options["timeInterval"] as? Number)?.toLong() ?: 1_000L).coerceAtLeast(500L)
    val distance = ((options["distanceInterval"] as? Number)?.toFloat() ?: 0f).coerceAtLeast(0f)
    selected.forEach { manager.requestLocationUpdates(it, interval, distance, listener, Looper.getMainLooper()) }
  }

  private fun serialize(location: Location): Map<String, Any?> = mapOf(
    "timestamp" to location.time.toDouble(),
    "mocked" to location.isFromMockProvider,
    "coords" to mapOf(
      "latitude" to location.latitude,
      "longitude" to location.longitude,
      "altitude" to if (location.hasAltitude()) location.altitude else null,
      "accuracy" to if (location.hasAccuracy()) location.accuracy.toDouble() else null,
      "altitudeAccuracy" to null,
      "heading" to if (location.hasBearing()) location.bearing.toDouble() else null,
      "speed" to if (location.hasSpeed()) location.speed.toDouble() else null
    )
  )
}
