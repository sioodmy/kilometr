package com.anonymous.kilometr.maps

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Czytnik archiwum kafelków KMTP v1 (patrz scripts/build-tile-pack.mjs).
 *
 * Katalog jest posortowany po (z, x, y), więc kafel szukamy wyszukiwaniem
 * binarnym wprost po pliku. Nie ładujemy indeksu do pamięci: pakiet ma
 * tysiące pozycji, a mapa pyta o nie wielokrotnie, ale pojedynczy odczyt
 * z pliku jest tańszy niż utrzymywanie struktury w RAM.
 *
 * Format:
 *   0..3   magic "KMTP"
 *   4..7   wersja (u32)
 *   8..11  liczba kafelków (u32)
 *   12..15 maxzoom (u32)
 *   16..   katalog: offset u64, len u32, z u8, x u16, y u16 (18 B na pozycję)
 *   potem  dane kafelków, kolejno wg katalogu
 */
class TilePack(private val file: File) {

    companion object {
        private const val HEADER_BYTES = 32
        private const val ENTRY_BYTES = 18
    }

    class MissingTile : Exception("Brak kafla w pakiecie")

    private val raf: RandomAccessFile = RandomAccessFile(file, "r")
    val count: Int
    val maxZoom: Int

    init {
        val header = ByteBuffer.allocate(HEADER_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        raf.seek(0)
        raf.readFully(header.array())
        // Magic to cztery bajty ASCII, więc porównujemy je jako tekst.
        val magic = String(header.array(), 0, 4, Charsets.US_ASCII)
        if (magic != "KMTP") throw IllegalStateException("To nie jest archiwum KMTP")
        header.position(4)
        val version = header.int
        if (version != 1) throw IllegalStateException("Nieobsługiwana wersja pakietu: $version")
        count = header.int
        maxZoom = header.int
    }

    private data class Entry(val offset: Long, val length: Int, val z: Int, val x: Int, val y: Int)

    /** Kafel albo null, gdy pakiet go nie zawiera. */
    fun tile(z: Int, x: Int, y: Int): ByteArray? {
        val e = find(z, x, y) ?: return null
        val buf = ByteArray(e.length)
        raf.seek(e.offset)
        raf.readFully(buf)
        return buf
    }

    /**
     * Porównanie szukanego (z, x, y) z wpisem katalogu.
     * Wynik < 0 oznacza, że wpis jest mniejszy od szukanego, czyli szukamy
     * dalej w prawo. `find` używa tego kierunku przy wyszukiwaniu binarnym.
     */
    private fun compare(z: Int, x: Int, y: Int, e: Entry): Int {
        if (e.z != z) return e.z - z
        if (e.x != x) return e.x - x
        return e.y - y
    }

    private fun entryAt(i: Int): Entry {
        val b = ByteBuffer.allocate(ENTRY_BYTES).order(ByteOrder.LITTLE_ENDIAN)
        raf.seek(HEADER_BYTES.toLong() + i.toLong() * ENTRY_BYTES)
        raf.readFully(b.array())
        return Entry(
            b.long, // offset
            b.int, // length
            b.get().toInt(), // z
            b.short.toInt() and 0xFFFF, // x
            b.short.toInt() and 0xFFFF, // y
        )
    }

    private fun find(z: Int, x: Int, y: Int): Entry? {
        var lo = 0
        var hi = count - 1
        while (lo <= hi) {
            val mid = (lo + hi) / 2
            val e = entryAt(mid)
            val c = compare(z, x, y, e)
            when {
                c == 0 -> return e
                c < 0 -> lo = mid + 1   // wpis mniejszy, szukamy dalej w prawo
                else -> hi = mid - 1
            }
        }
        return null
    }

    fun close() = raf.close()
}