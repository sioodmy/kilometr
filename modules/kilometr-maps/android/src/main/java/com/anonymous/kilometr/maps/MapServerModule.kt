package com.anonymous.kilometr.maps

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import fi.iki.elonen.NanoHTTPD
import java.io.File

/**
 * Lokalny serwer HTTP dla mapy trasy.
 *
 * Po co to w ogóle: MapLibre GL JS żyje w WebView, a dokument wstrzykujemy przez
 * `source={{ html }}`. Takie strony dostają origin `null`, więc `isSecureContext`
 * jest fałszywe, Service Worker się nie zarejestruje i nie da się podmienić
 * kafelków przez Cache API. Dodatkowo react-native-webview przechwytuje tylko
 * nawigację główną, a nie odpowiedź na zasób.
 *
 * Jedynym sposobem, żeby MapLibre zobaczył lokalne kafle, jest prawdziwy serwer.
 * Dlatego kafle i glify idą z 127.0.0.1, a dokument mapy dostaje bazowy URL
 * zamiast `about:blank`.
 *
 * Serwer nasłuchuje tylko wtedy, gdy ekran mapy jest otwarty.
 */
class MapServerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var server: NanoHTTPD? = null
    private var pack: TilePack? = null

    override fun getName(): String = NAME

    /** Czy pakiet kafelków jest już na telefonie. */
    @ReactMethod
    fun hasTilePack(promise: Promise) {
        val f = packFile(reactApplicationContext)
        promise.resolve(f.exists() && f.length() > 1024)
    }

    /** Startuje serwer i zwraca bazowy URL; odrzuca, gdy brak pakietu. */
    @ReactMethod
    fun start(promise: Promise) {
        if (server != null) {
            promise.resolve("http://127.0.0.1:${server!!.listeningPort}")
            return
        }
        val p = openPack()
        if (p == null) {
            promise.reject("no_pack", "Pakiet kafelków nie jest pobrany")
            return
        }
        pack = p
        try {
            val s = MapRequestHandler(p, reactApplicationContext)
            s.start(SOCKET_READ_TIMEOUT, false)
            server = s
            promise.resolve("http://127.0.0.1:${s.listeningPort}")
        } catch (e: Exception) {
            promise.reject("server_failed", e.message, e)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        stopServer()
        promise.resolve(null)
    }

    override fun invalidate() {
        stopServer()
        super.invalidate()
    }

    private fun stopServer() {
        server?.stop()
        server = null
        pack?.close()
        pack = null
    }

    private fun openPack(): TilePack? {
        val f = packFile(reactApplicationContext)
        if (!f.exists() || f.length() < 1024) return null
        return try {
            TilePack(f)
        } catch (e: Exception) {
            null
        }
    }

    private companion object {
        const val NAME = "KilometrMapServer"
        const val SOCKET_READ_TIMEOUT = 30_000

        fun packFile(ctx: Context): File = File(ctx.filesDir, "maps/wroclaw-tiles.ktp")
    }
}