package my.siood.kilometr.widgets

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

internal const val FALLBACK_LINK = "kilometr://"

/** Odjazd sprzed ponad 30 s uznajemy za odjechany. */
internal const val DEPARTED_GRACE_MS = 30_000L

internal fun openLink(context: Context, link: String?, requestCode: Int): PendingIntent {
  val uri = try {
    Uri.parse(if (link.isNullOrBlank()) FALLBACK_LINK else link)
  } catch (_: Throwable) {
    Uri.parse(FALLBACK_LINK)
  }
  // Bez setPackage system mógłby zapytać, czym otworzyć schemat kilometr://.
  val intent = Intent(Intent.ACTION_VIEW, uri)
    .setPackage(context.packageName)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  return PendingIntent.getActivity(
    context,
    requestCode,
    intent,
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )
}

/** Unikalny requestCode, żeby PendingIntenty wierszy się nie nadpisywały. */
internal fun requestCode(widgetId: Int, kind: Int, slot: Int = 0): Int =
  widgetId * 128 + kind * 16 + slot

internal fun minutesUntil(ts: Long, now: Long): Int = ((ts - now) / 60_000.0).roundToInt()

internal fun clock(ts: Long): String = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts))

/** Krótkie odliczanie do wiersza: „teraz”, „5 min” albo godzina, gdy to ponad godzinę. */
internal fun countdown(labels: Labels, ts: Long, departAt: String, now: Long): String {
  val m = minutesUntil(ts, now)
  return when {
    m <= 0 -> labels.get("now") ?: departAt
    m >= 60 -> departAt.ifEmpty { clock(ts) }
    else -> "$m ${labels.get("min") ?: "min"}"
  }
}

internal data class Status(val text: String, val color: Int)

/** Ten sam podział co w apce: opóźnienie live, na czas live, sam rozkład. */
internal fun status(context: Context, labels: Labels, delayMin: Int, live: Boolean): Status? {
  if (live && delayMin > 0) {
    val text = labels.format("late", "n" to delayMin.toString()) ?: return null
    return Status(text, context.getColor(R.color.kw_warning))
  }
  if (live) {
    val text = labels.get("onTime") ?: return null
    return Status(text, context.getColor(R.color.kw_success))
  }
  val text = labels.get("timetable") ?: return null
  return Status(text, context.getColor(R.color.kw_on_surface_variant))
}

/** „odjazd 12:34 · Na czas” z kolorem tylko na statusie. */
internal fun withStatus(base: String, status: Status?): CharSequence {
  if (status == null) return base
  val out = SpannableStringBuilder(base)
  if (base.isNotEmpty()) out.append(" · ")
  val start = out.length
  out.append(status.text)
  out.setSpan(ForegroundColorSpan(status.color), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
  return out
}

internal fun parseColor(hex: String?, fallback: Int): Int = try {
  if (hex.isNullOrBlank()) fallback else Color.parseColor(hex)
} catch (_: Throwable) {
  fallback
}

internal fun modeIcon(mode: String?): Int = when (mode) {
  "tram", "cable" -> R.drawable.kw_ic_tram
  "train", "subway" -> R.drawable.kw_ic_train
  "walk" -> R.drawable.kw_ic_walk
  "bus", "trolleybus" -> R.drawable.kw_ic_bus
  else -> R.drawable.kw_ic_bus
}

/** Ikona zapisanego miejsca. Nieznany klucz zostaje pinezką. */
internal fun placeIcon(icon: String?): Int = when (icon) {
  "home" -> R.drawable.kw_ic_home
  "work" -> R.drawable.kw_ic_work
  "school" -> R.drawable.kw_ic_school
  "train" -> R.drawable.kw_ic_train
  "tram" -> R.drawable.kw_ic_tram
  "bus" -> R.drawable.kw_ic_bus
  "history" -> R.drawable.kw_ic_clock
  "star" -> R.drawable.kw_ic_star
  "heart" -> R.drawable.kw_ic_heart
  "coffee" -> R.drawable.kw_ic_coffee
  "shopping" -> R.drawable.kw_ic_bag
  "gym" -> R.drawable.kw_ic_gym
  "restaurant", "sandwich" -> R.drawable.kw_ic_food
  "pizza" -> R.drawable.kw_ic_pizza
  "pharmacy" -> R.drawable.kw_ic_pill
  "park" -> R.drawable.kw_ic_park
  "cinema" -> R.drawable.kw_ic_film
  "culture" -> R.drawable.kw_ic_landmark
  "library" -> R.drawable.kw_ic_book
  "friends" -> R.drawable.kw_ic_people
  "church" -> R.drawable.kw_ic_church
  "car" -> R.drawable.kw_ic_car
  "bike" -> R.drawable.kw_ic_bike
  "plane" -> R.drawable.kw_ic_plane
  "market" -> R.drawable.kw_ic_store
  "university" -> R.drawable.kw_ic_uni
  "fuel" -> R.drawable.kw_ic_fuel
  "ship" -> R.drawable.kw_ic_ship
  "compass" -> R.drawable.kw_ic_compass
  "cart" -> R.drawable.kw_ic_cart
  "hospital" -> R.drawable.kw_ic_hospital
  "doctor" -> R.drawable.kw_ic_hospital
  "scissors" -> R.drawable.kw_ic_cut
  "sparkles" -> R.drawable.kw_ic_spark
  "theater" -> R.drawable.kw_ic_film
  "music" -> R.drawable.kw_ic_music
  "ticket" -> R.drawable.kw_ic_ticket
  "gamepad" -> R.drawable.kw_ic_game
  "mountain" -> R.drawable.kw_ic_mountain
  "tent" -> R.drawable.kw_ic_tent
  "trophy" -> R.drawable.kw_ic_trophy
  "swimming" -> R.drawable.kw_ic_pool
  "baby" -> R.drawable.kw_ic_baby
  "pet" -> R.drawable.kw_ic_pet
  "hotel" -> R.drawable.kw_ic_hotel
  "bank" -> R.drawable.kw_ic_bank
  "post" -> R.drawable.kw_ic_mail
  "laptop" -> R.drawable.kw_ic_laptop
  "beer" -> R.drawable.kw_ic_beer
  "wine" -> R.drawable.kw_ic_wine
  "plus" -> R.drawable.kw_ic_plus
  else -> R.drawable.kw_ic_pin
}

/** Badge linii jak LineBadge w apce. Odcinek pieszy to sama ikona na neutralnym tle. */
internal fun lineBadge(
  context: Context,
  mode: String?,
  line: String?,
  bg: String?,
  fg: String?,
): RemoteViews {
  val views = RemoteViews(context.packageName, R.layout.kw_badge_item)
  views.setImageViewResource(R.id.kw_badge_icon, modeIcon(mode))
  if (mode == "walk" || line.isNullOrBlank()) {
    views.setInt(R.id.kw_badge_bg, "setColorFilter", context.getColor(R.color.kw_surface_high))
    views.setInt(R.id.kw_badge_icon, "setColorFilter", context.getColor(R.color.kw_on_surface_variant))
    views.setViewVisibility(R.id.kw_badge_text, View.GONE)
    return views
  }
  val fgColor = parseColor(fg, Color.WHITE)
  views.setInt(R.id.kw_badge_bg, "setColorFilter", parseColor(bg, context.getColor(R.color.kw_primary_container)))
  views.setInt(R.id.kw_badge_icon, "setColorFilter", fgColor)
  views.setTextViewText(R.id.kw_badge_text, line)
  views.setTextColor(R.id.kw_badge_text, fgColor)
  return views
}
