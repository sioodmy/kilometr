package pl.wroclaw.kilometr.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

private const val KIND_NEXT = 0
private const val KIND_DEST = 1
private const val KIND_TRIP = 2
private const val KIND_SEARCH = 3
private const val KIND_SAVED = 4

private const val SEARCH_LINK = "kilometr://?search=1"
private const val PLACES_LINK = "kilometr://?places=1"

/** Podróż kończy się w widgecie 20 min po planowanym przyjeździe. */
private const val TRIP_LINGER_MS = 20 * 60_000L

private const val MAX_TRIP_LEGS = 5

private fun heightDp(options: Bundle?, fallback: Int): Int {
  val max = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) ?: 0
  if (max > 0) return max
  val min = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT) ?: 0
  return if (min > 0) min else fallback
}

private fun widthDp(options: Bundle?, fallback: Int): Int {
  val min = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 0
  return if (min > 0) min else fallback
}

private fun openAppText(context: Context, labels: Labels, key: String, snap: JSONObject?): String =
  (if (snap == null) null else labels.get(key)) ?: context.getString(R.string.kw_open_app)

internal object WidgetRenderers {

  fun next(context: Context, snap: JSONObject?, widgetId: Int, now: Long): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_next)
    val labels = Labels(snap?.optJSONObject("labels"))
    val item = snap?.optJSONArray("next").objects()
      .firstOrNull { it.optLong("departTs") >= now - DEPARTED_GRACE_MS }

    if (item == null) {
      views.setViewVisibility(R.id.kw_content, View.GONE)
      views.setViewVisibility(R.id.kw_empty, View.VISIBLE)
      views.setTextViewText(R.id.kw_empty_text, openAppText(context, labels, "nextEmpty", snap))
      views.setOnClickPendingIntent(android.R.id.background, openLink(context, FALLBACK_LINK, requestCode(widgetId, KIND_NEXT)))
      return views
    }

    views.setViewVisibility(R.id.kw_content, View.VISIBLE)
    views.setViewVisibility(R.id.kw_empty, View.GONE)
    views.removeAllViews(R.id.kw_badge_slot)
    views.addView(
      R.id.kw_badge_slot,
      lineBadge(context, item.optString("mode"), item.optString("line"), item.optString("lineBg"), item.optString("lineFg")),
    )

    val ts = item.optLong("departTs")
    val departAt = item.optString("departAt")
    val minutes = minutesUntil(ts, now)
    when {
      minutes <= 0 -> {
        views.setTextViewText(R.id.kw_big, labels.get("now") ?: departAt)
        views.setViewVisibility(R.id.kw_big_unit, View.GONE)
      }
      minutes >= 60 -> {
        views.setTextViewText(R.id.kw_big, departAt.ifEmpty { clock(ts) })
        views.setViewVisibility(R.id.kw_big_unit, View.GONE)
      }
      else -> {
        views.setTextViewText(R.id.kw_big, minutes.toString())
        views.setTextViewText(R.id.kw_big_unit, labels.get("min") ?: "min")
        views.setViewVisibility(R.id.kw_big_unit, View.VISIBLE)
      }
    }
    views.setTextViewText(R.id.kw_title, item.optString("dest"))
    views.setTextViewText(R.id.kw_sub, labels.format("departAt", "t" to departAt) ?: departAt)

    val st = status(context, labels, item.optInt("delayMin", 0), item.optBoolean("live", false))
    views.setTextViewText(R.id.kw_status, st?.text ?: "")
    st?.let { views.setTextColor(R.id.kw_status, it.color) }

    views.setOnClickPendingIntent(
      android.R.id.background,
      openLink(context, item.optString("deepLink"), requestCode(widgetId, KIND_NEXT)),
    )
    return views
  }

  fun destinations(context: Context, snap: JSONObject?, widgetId: Int, options: Bundle?, now: Long): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_dest)
    val labels = Labels(snap?.optJSONObject("labels"))
    val items = snap?.optJSONArray("quick").objects()

    views.setTextViewText(R.id.kw_header, snap?.optString("origin", "") ?: "")
    val updatedAt = snap?.optLong("updatedAt", 0L) ?: 0L
    views.setTextViewText(
      R.id.kw_updated,
      if (updatedAt > 0) labels.format("updated", "t" to clock(updatedAt)) ?: clock(updatedAt) else "",
    )
    views.setOnClickPendingIntent(android.R.id.background, openLink(context, FALLBACK_LINK, requestCode(widgetId, KIND_DEST)))
    views.removeAllViews(R.id.kw_rows)

    if (items.isEmpty()) {
      views.setViewVisibility(R.id.kw_rows, View.GONE)
      views.setViewVisibility(R.id.kw_empty, View.VISIBLE)
      views.setTextViewText(R.id.kw_empty, openAppText(context, labels, "destEmpty", snap))
      return views
    }
    views.setViewVisibility(R.id.kw_rows, View.VISIBLE)
    views.setViewVisibility(R.id.kw_empty, View.GONE)

    // Nagłówek + paddingi zajmują ok. 52 dp, wiersz ma 52 dp.
    val fit = ((heightDp(options, 180) - 52) / 52).coerceIn(1, 4)
    items.take(fit).forEachIndexed { index, item ->
      views.addView(R.id.kw_rows, destinationRow(context, labels, item, widgetId, index + 1, now))
    }
    return views
  }

  private fun destinationRow(
    context: Context,
    labels: Labels,
    item: JSONObject,
    widgetId: Int,
    slot: Int,
    now: Long,
  ): RemoteViews {
    val row = RemoteViews(context.packageName, R.layout.kw_dest_row)
    row.setImageViewResource(R.id.kw_row_icon, placeIcon(item.optString("icon")))
    row.setTextViewText(R.id.kw_row_title, item.optString("title"))
    row.removeAllViews(R.id.kw_row_badge)

    val ts = item.optLongOrNull("departTs")
    if (ts != null && ts >= now - DEPARTED_GRACE_MS) {
      val departAt = item.optString("departAt")
      val st = status(context, labels, item.optInt("delayMin", 0), item.optBoolean("live", false))
      row.setTextViewText(R.id.kw_row_sub, withStatus(labels.format("departAt", "t" to departAt) ?: departAt, st))
      row.setTextViewText(R.id.kw_row_time, countdown(labels, ts, departAt, now))
      val line = item.optString("line")
      if (line.isNotEmpty()) {
        row.addView(
          R.id.kw_row_badge,
          lineBadge(context, item.optString("mode"), line, item.optString("lineBg"), item.optString("lineFg")),
        )
      }
    } else {
      // Kurs już odjechał, a nowszego nie znamy: tap otworzy trasę i ją przeliczy.
      row.setTextViewText(R.id.kw_row_sub, if (ts != null) labels.get("stale") ?: "" else "")
      row.setTextViewText(R.id.kw_row_time, "")
    }
    row.setOnClickPendingIntent(R.id.kw_row, openLink(context, item.optString("deepLink"), requestCode(widgetId, KIND_DEST, slot)))
    return row
  }

  fun trip(context: Context, snap: JSONObject?, widgetId: Int, now: Long): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_trip)
    val labels = Labels(snap?.optJSONObject("labels"))
    val trip = snap?.optJSONObject("pinned")
    val departTs = trip?.optLongOrNull("departTs")
    val arriveTs = trip?.optLongOrNull("arriveTs")

    if (trip == null || departTs == null || arriveTs == null || now > arriveTs + TRIP_LINGER_MS) {
      views.setViewVisibility(R.id.kw_content, View.GONE)
      views.setViewVisibility(R.id.kw_empty, View.VISIBLE)
      views.setTextViewText(R.id.kw_empty_title, labels.get("tripEmptyTitle") ?: context.getString(R.string.kw_trip_label))
      views.setTextViewText(R.id.kw_empty_body, openAppText(context, labels, "tripEmptyBody", snap))
      views.setOnClickPendingIntent(android.R.id.background, openLink(context, FALLBACK_LINK, requestCode(widgetId, KIND_TRIP)))
      return views
    }

    views.setViewVisibility(R.id.kw_content, View.VISIBLE)
    views.setViewVisibility(R.id.kw_empty, View.GONE)
    views.setTextViewText(R.id.kw_title, "${trip.optString("fromTitle")} → ${trip.optString("toTitle")}")
    views.setTextViewText(R.id.kw_depart, trip.optString("departAt").ifEmpty { clock(departTs) })
    views.setTextViewText(R.id.kw_arrive, trip.optString("arriveAt").ifEmpty { clock(arriveTs) })

    val st = status(context, labels, trip.optInt("delayMin", 0), trip.optBoolean("live", false))
    views.setTextViewText(R.id.kw_status, st?.text ?: "")
    st?.let { views.setTextColor(R.id.kw_status, it.color) }

    val phase: String
    val progress: Int
    when {
      now < departTs - DEPARTED_GRACE_MS -> {
        val m = minutesUntil(departTs, now)
        phase = when {
          m <= 0 -> labels.get("departNow") ?: ""
          m >= 60 -> labels.format("departAt", "t" to clock(departTs)) ?: ""
          else -> labels.format("departIn", "n" to m.toString()) ?: ""
        }
        progress = 0
      }
      now < arriveTs -> {
        val m = minutesUntil(arriveTs, now).coerceAtLeast(1)
        phase = labels.format("arriveIn", "n" to m.toString()) ?: ""
        val span = (arriveTs - departTs).coerceAtLeast(1L)
        progress = (((now - departTs).coerceAtLeast(0L) * 1000L) / span).toInt().coerceIn(0, 1000)
      }
      else -> {
        phase = labels.get("arrived") ?: ""
        progress = 1000
      }
    }
    views.setTextViewText(R.id.kw_phase, phase)
    views.setProgressBar(R.id.kw_progress, 1000, progress, false)

    views.removeAllViews(R.id.kw_legs)
    trip.optJSONArray("legs").objects().take(MAX_TRIP_LEGS).forEachIndexed { index, leg ->
      if (index > 0) views.addView(R.id.kw_legs, RemoteViews(context.packageName, R.layout.kw_leg_sep))
      views.addView(
        R.id.kw_legs,
        lineBadge(context, leg.optString("mode"), leg.optString("line"), leg.optString("bg"), leg.optString("fg")),
      )
    }

    views.setOnClickPendingIntent(
      android.R.id.background,
      openLink(context, trip.optString("deepLink"), requestCode(widgetId, KIND_TRIP)),
    )
    return views
  }

  fun search(context: Context, snap: JSONObject?, widgetId: Int, options: Bundle?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_search)
    val labels = Labels(snap?.optJSONObject("labels"))
    labels.get("search")?.let { views.setTextViewText(R.id.kw_hint, it) }
    views.setOnClickPendingIntent(R.id.kw_search, openLink(context, SEARCH_LINK, requestCode(widgetId, KIND_SEARCH)))

    views.removeAllViews(R.id.kw_places)
    // Na wąskim widgecie zostawiamy miejsce na podpowiedź w pasku.
    val slots = if (widthDp(options, 250) >= 250) 2 else 1
    snap?.optJSONArray("places").objects().take(slots).forEachIndexed { index, place ->
      val button = RemoteViews(context.packageName, R.layout.kw_place_button)
      button.setImageViewResource(R.id.kw_place_icon, placeIcon(place.optString("icon")))
      button.setContentDescription(R.id.kw_place, place.optString("name"))
      button.setOnClickPendingIntent(
        R.id.kw_place,
        openLink(context, place.optString("deepLink"), requestCode(widgetId, KIND_SEARCH, index + 1)),
      )
      views.addView(R.id.kw_places, button)
    }
    return views
  }

  fun savedPlaces(context: Context, snap: JSONObject?, widgetId: Int, options: Bundle?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_saved_places)
    val labels = Labels(snap?.optJSONObject("labels"))
    val places = snap?.optJSONArray("places").objects()
    val rowIds = intArrayOf(R.id.kw_saved_row_0, R.id.kw_saved_row_1, R.id.kw_saved_row_2)

    views.setOnClickPendingIntent(
      android.R.id.background,
      openLink(context, PLACES_LINK, requestCode(widgetId, KIND_SAVED)),
    )
    rowIds.forEach {
      views.removeAllViews(it)
      views.setViewVisibility(it, View.GONE)
    }

    if (places.isEmpty()) {
      views.setViewVisibility(R.id.kw_saved_content, View.GONE)
      views.setViewVisibility(R.id.kw_saved_empty, View.VISIBLE)
      views.setTextViewText(
        R.id.kw_saved_empty_text,
        labels.get("placesEmpty") ?: context.getString(R.string.kw_saved_empty),
      )
      return views
    }

    views.setViewVisibility(R.id.kw_saved_content, View.VISIBLE)
    views.setViewVisibility(R.id.kw_saved_empty, View.GONE)

    val columns = if (widthDp(options, 110) >= 250) 4 else 2
    val maxRows = if (heightDp(options, 110) >= 180) 3 else 2
    val visible = places.take(columns * maxRows)
    val rows = ((visible.size + columns - 1) / columns).coerceAtLeast(1)

    for (rowIndex in 0 until rows) {
      val rowId = rowIds[rowIndex]
      views.setViewVisibility(rowId, View.VISIBLE)
      for (column in 0 until columns) {
        val index = rowIndex * columns + column
        val tile = RemoteViews(context.packageName, R.layout.kw_saved_place)
        if (index >= visible.size) {
          // Niewidoczny wypełniacz zachowuje szerokość kolumn ostatniego rzędu.
          tile.setViewVisibility(R.id.kw_saved_place, View.INVISIBLE)
        } else {
          val place = visible[index]
          val name = place.optString("name")
          tile.setImageViewResource(R.id.kw_saved_place_icon, placeIcon(place.optString("icon")))
          tile.setTextViewText(R.id.kw_saved_place_name, name)
          tile.setContentDescription(R.id.kw_saved_place, name)
          tile.setOnClickPendingIntent(
            R.id.kw_saved_place,
            openLink(
              context,
              place.optString("deepLink"),
              requestCode(widgetId, KIND_SAVED, index + 1),
            ),
          )
        }
        views.addView(rowId, tile)
      }
    }
    return views
  }
}
