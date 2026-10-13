package pl.wroclaw.kilometr.maps

import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Obsługuje żądania mapy:
 *   `/tiles/z/x/y.pbf` kafel z archiwum KMTP,
 *   `/assets/...`      silnik mapy, style i glify z filesDir/maps.
 *
 * WebView z `source={{ html }}` ma origin `null` / `about:blank`, więc
 * fetch kafelków z 127.0.0.1 to cross-origin. Bez CORS MapLibre dostaje
 * puste odpowiedzi i mapa zostaje czarna (sam kolor landu). Odpowiedzi
 * dostają `Access-Control-Allow-Origin: *` — lokalny serwer i tak nasłuchuje
 * tylko na pętli zwrotnej.
 */
class MapRequestHandler(
    private val pack: TilePack,
    private val assetsRoot: File? = null,
) : NanoHTTPD(ANY_PORT) {

    override fun serve(session: IHTTPSession): Response {
        // Preflight z WebView/Chromium (rzadki przy prostym GET, ale tani).
        if (session.method == Method.OPTIONS) {
            return cors(newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, ""))
        }
        val path = session.uri ?: return notFound()
        return when {
            path.startsWith("/tiles/") -> serveTile(path)
            path.startsWith("/assets/") -> serveAsset(path)
            else -> notFound()
        }
    }

    /** `/tiles/14/8967/5477.pbf` */
    private fun serveTile(path: String): Response {
        val parts = path.removePrefix("/tiles/").split("/")
        if (parts.size != 3) return notFound()
        val z = parts[0].toIntOrNull() ?: return notFound()
        val x = parts[1].substringBefore('.').toIntOrNull() ?: return notFound()
        val y = parts[2].substringBefore('.').toIntOrNull() ?: return notFound()
        if (z < 0 || z > 22) return notFound()

        val data = pack.tile(z, x, y) ?: return notFound()
        return cors(
            newFixedLengthResponse(
                Response.Status.OK,
                MIME_PBF,
                ByteArrayInputStream(data),
                data.size.toLong(),
            ),
        )
    }

    /** Silnik mapy, glify. Ścieżki z katalogu pobranego zestawu. */
    private fun serveAsset(path: String): Response {
        val name = path.removePrefix("/assets/").substringBefore('?')
        // Nie wychodzimy poza katalog zestawu.
        if (name.isEmpty() || name.contains("..")) return notFound()
        val root = assetsRoot ?: return notFound()
        val f = File(root, name)
        if (!f.exists()) return notFound()
        return cors(
            newFixedLengthResponse(
                Response.Status.OK,
                mimeOf(name),
                f.inputStream(),
                f.length(),
            ),
        )
    }

    private fun mimeOf(path: String): String = when {
        path.endsWith(".js") -> "application/javascript; charset=utf-8"
        path.endsWith(".css") -> "text/css; charset=utf-8"
        path.endsWith(".json") -> "application/json"
        path.endsWith(".pbf") -> MIME_PBF
        else -> "application/octet-stream"
    }

    private fun notFound() = cors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, ""))

    private fun cors(response: Response): Response {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
        response.addHeader("Access-Control-Allow-Headers", "*")
        return response
    }

    private companion object {
        const val ANY_PORT = 0
        const val MIME_PBF = "application/x-protobuf"
    }
}
