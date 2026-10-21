package app.kilometr.maps

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
 * Dlatego kafle, glify i silnik mapy idą z 127.0.0.1, a WebView dostaje
 * `baseUrl` tego serwera (origin zamiast `about:blank`) plus CORS na odpowiedziach.
 *
 * Serwer nasłuchuje tylko wtedy, gdy ekran mapy jest otwarty.
 */
class MapServerModule : Module() {

    private var server: NanoHTTPD? = null
    private var packs: List<TilePack> = emptyList()

    /** filesDir/maps - ten sam katalog, do którego pisze JS przy pobieraniu. */
    private val mapsDir: File?
        get() = appContext.reactContext?.applicationContext?.let { File(it.filesDir, "maps") }

    /** Wszystkie pakiety miast (`{miasto}-tiles.ktp`), każde miasto ma własny plik. */
    private fun packFiles(): List<File> =
        mapsDir?.listFiles { f -> f.isFile && f.name.endsWith("-tiles.ktp") }
            ?.sortedBy { it.name } ?: emptyList()

    private fun openPacks(): List<TilePack> {
        val out = mutableListOf<TilePack>()
        for (f in packFiles()) {
            if (!f.exists() || f.length() < 1024) continue
            try {
                out.add(TilePack(f))
            } catch (e: Exception) {
                // uszkodzony pakiet jednego miasta nie kładzie reszty
            }
        }
        return out
    }

    override fun definition() = ModuleDefinition {
        Name("KilometrMapServer")

        /** Startuje serwer, zwraca bazowy URL; null gdy brak pakietu. */
        AsyncFunction("start") {
            val files = packFiles().map { it.name to it.length() }
            val running = server
            // Zestaw pakietów zmienił się na dysku (pobrano/usunięto miasto):
            // otwarte uchwyty dotyczą starych plików, więc restartujemy serwer.
            if (running != null && files == packs.map { it.file.name to it.file.length() }) {
                return@AsyncFunction "http://127.0.0.1:${running.listeningPort}"
            }
            if (running != null) stopServer()
            val opened = openPacks()
            if (opened.isEmpty()) return@AsyncFunction null
            packs = opened
            try {
                val s = MapRequestHandler(opened, mapsDir)
                s.start(SOCKET_READ_TIMEOUT, false)
                server = s
                "http://127.0.0.1:${s.listeningPort}"
            } catch (e: Exception) {
                closePacks()
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

    private fun closePacks() {
        for (p in packs) {
            try {
                p.close()
            } catch (e: Exception) {
                // best-effort
            }
        }
        packs = emptyList()
    }

    private fun stopServer() {
        server?.stop()
        server = null
        closePacks()
    }

    private companion object {
        const val SOCKET_READ_TIMEOUT = 30_000
    }
}
