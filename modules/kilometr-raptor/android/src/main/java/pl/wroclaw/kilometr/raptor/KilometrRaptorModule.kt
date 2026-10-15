package pl.wroclaw.kilometr.raptor

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPInputStream

class KilometrRaptorModule : Module() {
  /** Kafle piesze z pakietów offline (`{miasto}-tiles.ktp` w filesDir/maps). */
  private fun packFiles(): List<File> {
    val ctx = appContext.reactContext?.applicationContext ?: return emptyList()
    val dir = File(ctx.filesDir, "maps")
    return dir.listFiles { f -> f.isFile && f.name.endsWith("-tiles.ktp") }
      ?.sortedBy { it.name } ?: emptyList()
  }

  private fun readTileFromPack(packFile: File, z: Int, x: Int, y: Int): ByteArray? {
    if (!packFile.exists() || packFile.length() < 32L) return null
    return try {
      RandomAccessFile(packFile, "r").use { raf ->
        val header = ByteBuffer.allocate(32).order(ByteOrder.LITTLE_ENDIAN)
        raf.seek(0)
        raf.readFully(header.array())
        val magic = String(header.array(), 0, 4, Charsets.US_ASCII)
        if (magic != "KMTP") return null
        header.position(4)
        val version = header.int
        if (version != 1 && version != 2) return null
        val count = header.int
        if (count <= 0) return null

        val entryBuf = ByteBuffer.allocate(18).order(ByteOrder.LITTLE_ENDIAN)
        var lo = 0
        var hi = count - 1
        while (lo <= hi) {
          val mid = (lo + hi) ushr 1
          entryBuf.clear()
          raf.seek(32L + mid.toLong() * 18L)
          raf.readFully(entryBuf.array())
          val offset = entryBuf.long
          val length = entryBuf.int
          val ez = entryBuf.get().toInt() and 0xFF
          val ex = entryBuf.short.toInt() and 0xFFFF
          val ey = entryBuf.short.toInt() and 0xFFFF
          val cmp = when {
            ez != z -> ez - z
            ex != x -> ex - x
            else -> ey - y
          }
          when {
            cmp == 0 -> {
              if (length <= 0 || offset < 32L) return null
              val data = ByteArray(length)
              raf.seek(offset)
              raf.readFully(data)
              return if (version == 2) {
                try {
                  GZIPInputStream(ByteArrayInputStream(data)).use { it.readBytes() }
                } catch (_: Throwable) {
                  null
                }
              } else {
                data
              }
            }
            cmp < 0 -> lo = mid + 1
            else -> hi = mid - 1
          }
        }
        null
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun readTileFromLocalPack(z: Int, x: Int, y: Int): ByteArray? {
    for (packFile in packFiles()) {
      readTileFromPack(packFile, z, x, y)?.let { return it }
    }
    return null
  }

  private fun cachedTileFile(tx: Int, ty: Int): File? {
    val ctx = appContext.reactContext?.applicationContext ?: return null
    val dir = File(ctx.cacheDir, "foot-tiles")
    return File(dir, "14_${tx}_${ty}.pbf")
  }

  private fun readCachedTile(tx: Int, ty: Int): ByteArray? {
    val file = cachedTileFile(tx, ty) ?: return null
    if (!file.exists() || file.length() <= 16L) return null
    return try {
      file.readBytes()
    } catch (_: Throwable) {
      null
    }
  }

  private fun writeCachedTile(tx: Int, ty: Int, bytes: ByteArray) {
    val file = cachedTileFile(tx, ty) ?: return
    try {
      file.parentFile?.mkdirs()
      file.writeBytes(bytes)
    } catch (_: Throwable) {
      // Cache zapisywany best-effort.
    }
  }

  private fun ensureFootTileFromPackInternal(tx: Int, ty: Int): Boolean {
    if (!KilometrRaptorBridge.isLoaded) return false
    if (KilometrRaptorBridge.nativeHasFootTile(tx, ty)) return true
    val bytes = readTileFromLocalPack(14, tx, ty) ?: readCachedTile(tx, ty) ?: return false
    return KilometrRaptorBridge.nativeLoadFootTile(tx, ty, bytes)
  }

  override fun definition() = ModuleDefinition {
    Name("KilometrRaptor")

    Function("isAvailable") {
      KilometrRaptorBridge.isLoaded
    }

    Function("hasNetworkSync") { netId: Int ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeHasNetwork(netId)
      }
    }

    Function("loadNetworkSync") { netId: Int, packedNet: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeLoadNetwork(netId, packedNet)
      }
    }

    Function("dropNetworkSync") { netId: Int ->
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeDropNetwork(netId)
      }
    }

    Function("clearNetworksSync") {
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeClearNetworks()
      }
    }

    Function("runQuerySync") { packedQuery: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        null
      } else {
        KilometrRaptorBridge.nativeRunQuery(packedQuery)
      }
    }

    Function("hasFootTileSync") { tx: Int, ty: Int ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeHasFootTile(tx, ty)
      }
    }

    Function("loadFootTileSync") { tx: Int, ty: Int, mvtBytes: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        val ok = KilometrRaptorBridge.nativeLoadFootTile(tx, ty, mvtBytes)
        if (ok) writeCachedTile(tx, ty, mvtBytes)
        ok
      }
    }

    Function("loadFootTileFromPackSync") { tx: Int, ty: Int ->
      ensureFootTileFromPackInternal(tx, ty)
    }

    Function("clearFootTilesSync") {
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeClearFootTiles()
      }
    }

    Function("routeFootSync") { packedReq: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        null
      } else {
        KilometrRaptorBridge.nativeRouteFoot(packedReq)
      }
    }

    AsyncFunction("hasNetwork") { netId: Int ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeHasNetwork(netId)
      }
    }

    AsyncFunction("loadNetwork") { netId: Int, packedNet: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeLoadNetwork(netId, packedNet)
      }
    }

    AsyncFunction("dropNetwork") { netId: Int ->
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeDropNetwork(netId)
      }
    }

    AsyncFunction("clearNetworks") {
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeClearNetworks()
      }
    }

    AsyncFunction("runQuery") { packedQuery: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        null
      } else {
        KilometrRaptorBridge.nativeRunQuery(packedQuery)
      }
    }

    AsyncFunction("hasFootTile") { tx: Int, ty: Int ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        KilometrRaptorBridge.nativeHasFootTile(tx, ty)
      }
    }

    AsyncFunction("loadFootTile") { tx: Int, ty: Int, mvtBytes: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        false
      } else {
        val ok = KilometrRaptorBridge.nativeLoadFootTile(tx, ty, mvtBytes)
        if (ok) writeCachedTile(tx, ty, mvtBytes)
        ok
      }
    }

    AsyncFunction("loadFootTileFromPack") { tx: Int, ty: Int ->
      ensureFootTileFromPackInternal(tx, ty)
    }

    AsyncFunction("clearFootTiles") {
      if (KilometrRaptorBridge.isLoaded) {
        KilometrRaptorBridge.nativeClearFootTiles()
      }
    }

    AsyncFunction("routeFoot") { packedReq: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        null
      } else {
        KilometrRaptorBridge.nativeRouteFoot(packedReq)
      }
    }

    Function("invokeSync") { cmd: Int, payload: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        null
      } else {
        KilometrRaptorBridge.nativeInvoke(cmd, payload)
      }
    }

    AsyncFunction("invoke") { cmd: Int, payload: ByteArray ->
      if (!KilometrRaptorBridge.isLoaded) {
        null
      } else {
        KilometrRaptorBridge.nativeInvoke(cmd, payload)
      }
    }
  }
}
