package com.anonymous.kilometr.tracking

import android.content.Context
import android.os.Build

/**
 * Kolory Material You z tapety (Android 12+).
 *
 * Android udostępnia pięć palet tonalnych (`system_accent1_*`,
 * `system_accent2_*`, `system_accent3_*`, `system_neutral1_*`,
 * `system_neutral2_*`), w których nazwa zasobu koduje ton: `accent1_200` to
 * ton 20, `accent1_900` — ton 90. Nie budujemy tu palety ani nie liczymy
 * kontrastu — dostarczamy surowe tony do JS, który przypisuje je do ról
 * motywu (`src/theme/dynamic.ts`).
 *
 * Zasada: jeśli systemu nie zna tych zasobów (Android 11 i starsze), zwracamy
 * pustą mapę i aplikacja zostaje na własnej palecie.
 */
internal object DynamicColors {

  private val FAMILIES = listOf("accent1", "accent2", "accent3", "neutral1", "neutral2")
  private val TONES = listOf(0, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000)

  /**
   * Surowa paleta systemu jako `rodzina_ton` → `#RRGGBBAA`, albo pusta mapa.
   *
   * Nazwy zasobów szukamy po identyfikatorze zamiast po stałych
   * `android.R.color.*`, bo te ostatnie wymagają `compileSdk` z Android 12 —
   * a buildy robimy różnymi narzędziami i nie chcemy, żeby zmiana SDK
   * wywalała cały moduł.
   */
  fun read(context: Context): Map<String, String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return emptyMap()
    val res = context.resources
    val out = HashMap<String, String>()
    try {
      for (family in FAMILIES) {
        for (tone in TONES) {
          val id = res.getIdentifier("system_${family}_$tone", "color", "android")
          if (id == 0) continue
          out["${family}_$tone"] = hex(res.getColor(id, null))
        }
      }
    } catch (_: Throwable) {
      return emptyMap()
    }
    // Półpalety bez neutrali nie da się złożyć w czytelny motyw — wolimy
    // własną paletę niż powierzchnie w losowych kolorach.
    return if (out.containsKey("neutral1_900") && out.containsKey("accent1_200")) out else emptyMap()
  }

  private fun hex(color: Int): String = String.format("#%08X", color)
}
