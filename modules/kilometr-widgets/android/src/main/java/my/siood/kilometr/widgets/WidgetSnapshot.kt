package my.siood.kilometr.widgets

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Snapshot pisany przez apkę (`src/services/widgetSnapshot.ts`) do
 * `filesDir/kilometr-widget.json`.
 *
 * Odjazdy lecą jako znaczniki czasu, a nie gotowe „za X min”: widget liczy
 * minuty sam przy każdym tyknięciu, więc odliczanie żyje bez procesu JS.
 * Etykiety też przychodzą w snapshocie, ze słownika apki, żeby język wybrany
 * w Ustawieniach obowiązywał również na ekranie głównym.
 */
internal object WidgetSnapshot {
  const val FILE = "kilometr-widget.json"

  fun read(context: Context): JSONObject? = try {
    val file = File(context.filesDir, FILE)
    if (file.exists()) JSONObject(file.readText()) else null
  } catch (_: Throwable) {
    null
  }
}

internal class Labels(private val source: JSONObject?) {
  fun get(key: String): String? = source?.optString(key, "")?.takeIf { it.isNotEmpty() }

  /** Szablon ze słownika z podstawieniem `{klucz}`. */
  fun format(key: String, vararg values: Pair<String, String>): String? {
    var out = get(key) ?: return null
    for ((name, value) in values) out = out.replace("{$name}", value)
    return out
  }
}

internal fun JSONArray?.objects(): List<JSONObject> {
  if (this == null) return emptyList()
  val out = ArrayList<JSONObject>(length())
  for (i in 0 until length()) optJSONObject(i)?.let(out::add)
  return out
}

internal fun JSONObject.optLongOrNull(key: String): Long? =
  if (has(key) && !isNull(key)) optLong(key) else null
