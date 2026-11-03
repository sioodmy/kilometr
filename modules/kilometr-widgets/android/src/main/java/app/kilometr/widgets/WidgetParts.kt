package app.kilometr.widgets

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import androidx.core.graphics.ColorUtils
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

internal fun parseColor(hex: String?, fallback: Int): Int = try {
  if (hex.isNullOrBlank()) fallback else {
    val clean = hex.trim()
    val withHash = if (clean.startsWith("#")) clean else "#$clean"
    Color.parseColor(withHash)
  }
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

/**
 * Tło badge'a z hexu z snapshotu. RemoteViews nie zrenderuje kształtu przez
 * setColorFilter, więc każdy kolor palety apki ma własny shape w res/.
 * Słownik musi pokrywać się z src/services/lineIdentity.ts (sprawdza check:widget-badge).
 */
internal fun badgeBgResource(bg: String?): Int = when (bg?.trim()?.removePrefix("#")?.uppercase(Locale.ROOT)) {
  "71D8C2" -> R.drawable.kw_badge_71d8c2
  "96CCFF" -> R.drawable.kw_badge_96ccff
  "FFB3B6" -> R.drawable.kw_badge_ffb3b6
  "EBB2FF" -> R.drawable.kw_badge_ebb2ff
  "FFB95A" -> R.drawable.kw_badge_ffb95a
  "BAC3FF" -> R.drawable.kw_badge_bac3ff
  "97D77D" -> R.drawable.kw_badge_97d77d
  "FFAEDE" -> R.drawable.kw_badge_ffaede
  "6DD5E6" -> R.drawable.kw_badge_6dd5e6
  "FFB596" -> R.drawable.kw_badge_ffb596
  "CBBEFF" -> R.drawable.kw_badge_cbbeff
  "87CFFA" -> R.drawable.kw_badge_87cffa
  "CECC50" -> R.drawable.kw_badge_cecc50
  "FCABF7" -> R.drawable.kw_badge_fcabf7
  "79D6D3" -> R.drawable.kw_badge_79d6d3
  "AFCBD5" -> R.drawable.kw_badge_afcbd5
  "F6BA8C" -> R.drawable.kw_badge_f6ba8c
  "7ADA9E" -> R.drawable.kw_badge_7ada9e
  "ACC7FF" -> R.drawable.kw_badge_acc7ff
  "FFB1C5" -> R.drawable.kw_badge_ffb1c5
  "98D3B9" -> R.drawable.kw_badge_98d3b9
  "FFB4A7" -> R.drawable.kw_badge_ffb4a7
  "DAB9FF" -> R.drawable.kw_badge_dab9ff
  "ABCAE5" -> R.drawable.kw_badge_abcae5
  "FFB957" -> R.drawable.kw_badge_train
  "A5CCE8" -> R.drawable.kw_badge_cable
  "A8C7FA" -> R.drawable.kw_badge_m1
  "FFB4AB" -> R.drawable.kw_badge_m2
  else -> R.drawable.kw_badge_container
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
    views.setInt(R.id.kw_badge_body, "setBackgroundResource", R.drawable.kw_badge_walk)
    views.setInt(R.id.kw_badge_icon, "setColorFilter", context.getColor(R.color.kw_on_surface_variant))
    views.setViewVisibility(R.id.kw_badge_text, View.GONE)
    return views
  }
  val bgRes = badgeBgResource(bg)
  val fgColor = if (bgRes == R.drawable.kw_badge_container) {
    // Fallback zmienia tło, więc musi też zastąpić kolor tekstu ze snapshotu.
    context.getColor(R.color.kw_on_primary_container)
  } else {
    val initialFg = parseColor(fg, Color.WHITE)
    val parsedBg = parseColor(bg, Color.TRANSPARENT)
    if (parsedBg != Color.TRANSPARENT && ColorUtils.calculateContrast(initialFg, parsedBg) < 4.5) {
      val whiteContrast = ColorUtils.calculateContrast(Color.WHITE, parsedBg)
      val darkContrast = ColorUtils.calculateContrast(Color.BLACK, parsedBg)
      if (whiteContrast >= darkContrast) Color.WHITE else Color.BLACK
    } else {
      initialFg
    }
  }
  views.setInt(R.id.kw_badge_body, "setBackgroundResource", bgRes)
  views.setInt(R.id.kw_badge_icon, "setColorFilter", fgColor)
  views.setTextViewText(R.id.kw_badge_text, line)
  views.setTextColor(R.id.kw_badge_text, fgColor)
  return views
}
