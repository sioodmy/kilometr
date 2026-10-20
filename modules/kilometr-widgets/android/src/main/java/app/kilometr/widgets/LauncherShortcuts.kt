package app.kilometr.widgets

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONObject

/**
 * Dynamiczne skróty po przytrzymaniu ikony na launcherze.
 * Android pokazuje najwyżej tyle, ile zwraca getMaxShortcutCountPerActivity (zwykle 4–5).
 * Zapisujemy tylko gdy lista miejsc się zmieni: setDynamicShortcuts jest limitowane.
 */
internal object LauncherShortcuts {
  private var lastKey: String? = null

  fun sync(context: Context, snap: JSONObject?) {
    val places = snap?.optJSONArray("places")
    val key = places?.toString() ?: ""
    if (key == lastKey) return
    try {
      val max = ShortcutManagerCompat.getMaxShortcutCountPerActivity(context)
      if (max <= 0 || places == null || places.length() == 0) {
        ShortcutManagerCompat.removeAllDynamicShortcuts(context)
        lastKey = key
        return
      }
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val shortcuts = ArrayList<ShortcutInfoCompat>(max)
      val count = minOf(places.length(), max)
      for (i in 0 until count) {
        val place = places.optJSONObject(i) ?: continue
        val name = place.optString("name").trim()
        if (name.isEmpty()) continue
        val id = place.optString("id").ifBlank { "place-$i" }.take(64)
        val link = place.optString("deepLink")
        val uri = try {
          Uri.parse(if (link.isBlank()) FALLBACK_LINK else link)
        } catch (_: Throwable) {
          Uri.parse(FALLBACK_LINK)
        }
        val intent = Intent(Intent.ACTION_VIEW, uri)
          .setPackage(context.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (launch?.component != null) intent.component = launch.component
        shortcuts.add(
          ShortcutInfoCompat.Builder(context, id)
            .setShortLabel(name.take(25))
            .setLongLabel(name.take(40))
            .setIcon(shortcutIcon(context, placeIcon(place.optString("icon"))))
            .setRank(shortcuts.size)
            .setIntent(intent)
            .build(),
        )
      }
      ShortcutManagerCompat.setDynamicShortcuts(context, shortcuts)
      lastKey = key
    } catch (_: Throwable) {
      lastKey = null
    }
  }

  /** Wektory widgetów są białe (tint w layoucie). Na launcherze rysujemy je w kolorze marki. */
  private fun shortcutIcon(context: Context, res: Int): IconCompat {
    val size = (context.resources.displayMetrics.density * 48).toInt().coerceAtLeast(48)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val drawable = ContextCompat.getDrawable(context, res)?.mutate()
    if (drawable != null) {
      drawable.setTint(0xFF006A60.toInt())
      val pad = size / 8
      drawable.setBounds(pad, pad, size - pad, size - pad)
      drawable.draw(Canvas(bitmap))
    }
    return IconCompat.createWithBitmap(bitmap)
  }
}
