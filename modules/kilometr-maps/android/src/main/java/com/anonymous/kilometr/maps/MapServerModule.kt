package com.anonymous.kilometr.maps

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
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
 * Dlatego kafle, glify i silnik mapy idą z 127.0.0.1, a dokument mapy dostaje
 * bazowy URL zamiast `about:blank`.
 *
 * Serwer nasłuchuje tylko wtedy, gdy ekran mapy jest otwarty.
 */
class MapServerModule : Module() {

    private var server: NanoHTTPD? = null
    private var pack: TilePack? = null

    /** filesDir/maps — ten sam katalog, do którego pisze JS przy pobieraniu. */
    private val mapsDir: File?
        get() = appContext.reactContext?.applicationContext?.let { File(it.filesDir, "maps") }

    private fun packFile(): File? = mapsDir?.let { File(it, "wroclaw-tiles.ktp") }

    private fun openPack(): TilePack? {
        val f = packFile() ?: return null
        if (!f.exists() || f.length() < 1024) return null
        return try {
            TilePack(f)
        } catch (e: Exception) {
            null
        }
    }

    override fun definition() = ModuleDefinition {
        Name("KilometrMapServer")

        /** Czy pakiet kafelków jest już na telefonie. */
        AsyncFunction("hasTilePack") {
            val f = packFile() ?: return@AsyncFunction false
            f.exists() && f.length() > 1024
        }

        /** Startuje serwer, zwraca bazowy URL; null gdy brak pakietu. */
        AsyncFunction("start") {
            server?.let { return@AsyncFunction "http://127.0.0.1:${it.listeningPort}" }
            val p = openPack() ?: return@AsyncFunction null
            pack = p
            try {
                val s = MapRequestHandler(p, mapsDir)
                s.start(SOCKET_READ_TIMEOUT, false)
                server = s
                "http://127.0.0.1:${s.listeningPort}"
            } catch (e: Exception) {
                null
            }
        }

        AsyncFunction("stop") {
            stopServer()
        }

        OnDestroy {
            stopServer()
        }
    }

    private fun stopServer() {
        server?.stop()
        server = null
        pack?.close()
        pack = null
    }

    private companion object {
        const val SOCKET_READ_TIMEOUT = 30_000
    }
}