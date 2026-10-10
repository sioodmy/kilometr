package com.anonymous.kilometr.maps

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.File

/**
 * Obsługuje żądania mapy:
 *   `/tiles/z/x/y.pbf` kafel z archiwum KMTP,
 *   `/assets/...`      silnik mapy i glify z katalogu assets albo filesDir.
 *
 * Wszystko idzie z 127.0.0.1, więc przeglądarka nie pyta o CORS.
 */
class MapRequestHandler(
    private val pack: TilePack,
    private val ctx: Context,
) : NanoHTTPD(ANY_PORT) {

    override fun serve(session: IHTTPSession): Response {
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
        return newFixedLengthResponse(
            Response.Status.OK,
            MIME_PBF,
            ByteArrayInputStream(data),
            data.size.toLong(),
        )
    }

    /** Silnik mapy, style, glify. Ścieżki z assets albo filesDir/maps. */
    private fun serveAsset(path: String): Response {
        val name = path.removePrefix("/assets/").substringBefore('?')
        // Nie wychodzimy poza katalogi aplikacji.
        if (name.isEmpty() || name.contains("..")) return notFound()
        val f = listOf(File(ctx.assets, name), File(ctx.filesDir, "maps/$name"))
            .firstOrNull { it.exists() } ?: return notFound()
        return newFixedLengthResponse(Response.Status.OK, mimeOf(name), f.inputStream())
    }

    private fun mimeOf(path: String): String = when {
        path.endsWith(".js") -> "application/javascript; charset=utf-8"
        path.endsWith(".css") -> "text/css; charset=utf-8"
        path.endsWith(".json") -> "application/json"
        path.endsWith(".pbf") -> MIME_PBF
        else -> "application/octet-stream"
    }

    private fun notFound() = newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "")

    private companion object {
        const val ANY_PORT = 0
        const val MIME_PBF = "application/x-protobuf"
    }
}