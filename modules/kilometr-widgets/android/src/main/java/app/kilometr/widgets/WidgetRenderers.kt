package app.kilometr.widgets

import android.appwidget.AppWidgetManager
import android.content.Context
import android.graphics.Paint
import android.os.Bundle
import android.util.TypedValue
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

private fun heightDp(options: Bundle?, fallback: Int): Int =
  options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)?.takeIf { it > 0 } ?: fallback

private fun widthDp(options: Bundle?, fallback: Int): Int =
  options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)?.takeIf { it > 0 } ?: fallback

private fun RemoteViews.show(id: Int, visible: Boolean) = setViewVisibility(id, if (visible) View.VISIBLE else View.GONE)

private fun updated(labels: Labels, snap: JSONObject?): String {
  val time = snap?.optLong("updatedAt", 0L) ?: 0L
  return if (time > 0) labels.format("updated", "t" to clock(time)) ?: clock(time) else ""
}

internal object WidgetRenderers {
  fun next(context: Context, snap: JSONObject?, widgetId: Int, options: Bundle?, now: Long): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_next)
    val labels = Labels(snap?.optJSONObject("labels"))
    val scale = context.resources.configuration.fontScale.coerceAtLeast(1f)
    val height = heightDp(options, 180)
    val width = widthDp(options, 180)
    val compact = height < 170 * scale
    if (compact) {
      val padding = (12 * context.resources.displayMetrics.density).toInt()
      views.setViewPadding(R.id.kw_content, padding, padding, padding, padding)
      views.setViewPadding(R.id.kw_empty, padding, padding, padding, padding)
    }
    val item = snap?.optJSONArray("next").objects()
      .filter { it.optLong("departTs") >= now - DEPARTED_GRACE_MS }
      .minByOrNull { it.optLong("departTs") }

    views.show(R.id.kw_content, item != null)
    views.show(R.id.kw_empty, item == null)
    if (item == null) {
      val message = labels.get(if (compact) "search" else if (snap == null) "openApp" else "nextEmpty")
        ?: context.getString(if (compact) R.string.kw_search_hint else R.string.kw_open_app)
      views.setTextViewText(R.id.kw_empty_text, message)
      views.show(R.id.kw_empty_icon, height >= 150 * scale)
      views.setTextViewTextSize(R.id.kw_empty_text, TypedValue.COMPLEX_UNIT_SP, if (compact) 12f else 14f)
      views.setOnClickPendingIntent(android.R.id.background, openLink(context, FALLBACK_LINK, requestCode(widgetId, KIND_NEXT)))
      return views
    }

    views.setTextViewText(R.id.kw_next_label, labels.get("nextTitle") ?: context.getString(R.string.kw_next_label))
    views.show(R.id.kw_next_header, height >= 130 * scale)
    views.removeAllViews(R.id.kw_badge_slot)
    views.show(R.id.kw_badge_slot, width >= 170 * scale && !compact)
    views.addView(R.id.kw_badge_slot,
      lineBadge(context, item.optString("mode"), item.optString("line"), item.optString("lineBg"), item.optString("lineFg")))

    val ts = item.optLong("departTs")
    val minutes = minutesUntil(ts, now)
    val numeric = minutes in 1..59
    val value = when {
      minutes <= 0 -> labels.get("now") ?: item.optString("departAt")
      minutes >= 60 -> item.optString("departAt").ifEmpty { clock(ts) }
      else -> minutes.toString()
    }
    views.setTextViewText(R.id.kw_big, value)
    views.show(R.id.kw_big_unit, numeric)
    views.setTextViewText(R.id.kw_big_unit, labels.get("min") ?: context.getString(R.string.kw_min))
    val paint = Paint().apply { textSize = 64f * scale }
    val availableWidth = (width - 32 - if (numeric) 42 * scale else 0f).coerceAtLeast(32f)
    val widthLimit = 64f * availableWidth / paint.measureText(value).coerceAtLeast(1f)
    val heightLimit = ((height - 36 - 20 * scale - (if (compact) 20 else 56) * scale) / scale).coerceAtLeast(22f)
    views.setTextViewTextSize(R.id.kw_big, TypedValue.COMPLEX_UNIT_SP,
      minOf(if (numeric) 72f else 38f, widthLimit, heightLimit))
    views.setTextViewTextSize(R.id.kw_big_unit, TypedValue.COMPLEX_UNIT_SP, if (compact) 14f else 18f)
    views.setTextViewTextSize(R.id.kw_title, TypedValue.COMPLEX_UNIT_SP, if (compact) 14f else 16f)
    views.setInt(R.id.kw_title, "setMaxLines", if (compact) 1 else 2)
    views.setTextViewText(R.id.kw_title, item.optString("dest"))
    views.show(R.id.kw_sub, !compact)
    views.setTextViewText(R.id.kw_sub, updated(labels, snap))
    views.setContentDescription(android.R.id.background,
      listOf(labels.get("nextTitle"), countdown(labels, ts, item.optString("departAt"), now),
        item.optString("line"), item.optString("dest"), updated(labels, snap)).filterNotNull().filter { it.isNotBlank() }.joinToString(", "))
    views.setOnClickPendingIntent(android.R.id.background,
      openLink(context, item.optString("deepLink"), requestCode(widgetId, KIND_NEXT)))
    return views
  }

  fun destinations(context: Context, snap: JSONObject?, widgetId: Int, options: Bundle?, now: Long): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_dest)
    val labels = Labels(snap?.optJSONObject("labels"))
    val items = snap?.optJSONArray("quick").objects().toMutableList()
    val links = items.map { it.optString("deepLink") }.toMutableSet()
    snap?.optJSONArray("places").objects().forEach { place ->
      if (links.add(place.optString("deepLink"))) {
        items.add(JSONObject().put("title", place.optString("name")).put("icon", place.optString("icon"))
          .put("deepLink", place.optString("deepLink")))
      }
    }
    val scale = context.resources.configuration.fontScale.coerceAtLeast(1f)
    val height = heightDp(options, 260)
    val compact = height < 200 * scale
    val footer = !compact && updated(labels, snap).isNotEmpty()
    val contentHeight = height - 24 - (if (compact) 0 else 56) - (if (footer) (18 * scale).toInt() else 0)
    val fit = (contentHeight / (72 * scale)).toInt().coerceIn(1, 4)
    val rowHeight = contentHeight / minOf(fit, items.size.coerceAtLeast(1))
    views.show(R.id.kw_dest_header, !compact)
    views.show(R.id.kw_updated, footer)
    views.show(R.id.kw_origin, scale <= 1.1f)
    views.setTextViewText(R.id.kw_header, labels.get("journeyTitle") ?: context.getString(R.string.kw_dest_label))
    val origin = snap?.optString("origin", "").orEmpty()
    views.setTextViewText(R.id.kw_origin, if (origin.isNotBlank()) labels.format("fromOrigin", "name" to origin) ?: origin else "")
    views.setTextViewText(R.id.kw_updated, updated(labels, snap))
    views.setContentDescription(R.id.kw_refresh_action, labels.get("refresh") ?: context.getString(R.string.kw_refresh))
    views.setOnClickPendingIntent(R.id.kw_refresh_action, openLink(context, FALLBACK_LINK, requestCode(widgetId, KIND_DEST, 15)))
    views.setOnClickPendingIntent(android.R.id.background, openLink(context, FALLBACK_LINK, requestCode(widgetId, KIND_DEST)))
    views.removeAllViews(R.id.kw_rows)
    views.show(R.id.kw_rows, items.isNotEmpty())
    views.show(R.id.kw_empty, items.isEmpty())
    views.setTextViewText(R.id.kw_empty, labels.get(if (snap == null) "openApp" else "destEmpty") ?: context.getString(R.string.kw_open_app))
    items.take(fit).forEachIndexed { index, item ->
      views.addView(R.id.kw_rows, destinationRow(context, labels, item, widgetId, index, now, rowHeight, scale))
    }
    return views
  }

  private fun destinationRow(context: Context, labels: Labels, item: JSONObject, widgetId: Int, index: Int,
    now: Long, rowHeight: Int, scale: Float): RemoteViews {
    val row = RemoteViews(context.packageName, R.layout.kw_dest_row)
    val featured = index == 0
    val textColor = context.getColor(if (featured) R.color.kw_on_primary_container else R.color.kw_on_surface)
    row.setInt(R.id.kw_row, "setBackgroundResource", if (featured) R.drawable.kw_target_featured else R.drawable.kw_target)
    row.setTextColor(R.id.kw_row_title, textColor)
    row.setTextColor(R.id.kw_row_time, textColor)
    row.setTextColor(R.id.kw_row_sub, textColor)
    row.setInt(R.id.kw_row_icon, "setColorFilter", textColor)
    row.setImageViewResource(R.id.kw_row_icon, placeIcon(item.optString("icon")))
    row.setTextViewText(R.id.kw_row_title, item.optString("title"))
    row.setInt(R.id.kw_row_title, "setMaxLines", if (rowHeight >= 112 * scale) 2 else 1)
    row.setTextViewTextSize(R.id.kw_row_time, TypedValue.COMPLEX_UNIT_SP, if (scale > 1.3f) 16f else 24f)
    row.show(R.id.kw_row_detail, rowHeight >= 76 * scale)
    row.removeAllViews(R.id.kw_row_badge)
    val ts = item.optLongOrNull("departTs")
    val upcoming = ts != null && ts >= now - DEPARTED_GRACE_MS
    row.show(R.id.kw_row_time, upcoming)
    row.show(R.id.kw_row_icon, !upcoming)
    val detail: String
    if (upcoming) {
      val departAt = item.optString("departAt").ifEmpty { clock(ts!!) }
      detail = labels.format("departAt", "t" to departAt) ?: departAt
      row.setTextViewText(R.id.kw_row_time, countdown(labels, ts!!, departAt, now))
      if (item.optString("line").isNotEmpty()) {
        row.addView(R.id.kw_row_badge,
          lineBadge(context, item.optString("mode"), item.optString("line"), item.optString("lineBg"), item.optString("lineFg")))
      }
    } else {
      detail = labels.get(if (ts == null) "checkRoutes" else "stale") ?: context.getString(R.string.kw_open_app)
    }
    row.setTextViewText(R.id.kw_row_sub, detail)
    row.setContentDescription(R.id.kw_row, listOf(item.optString("title"), item.optString("line"), detail).filter { it.isNotBlank() }.joinToString(", "))
    row.setOnClickPendingIntent(R.id.kw_row, openLink(context, item.optString("deepLink"), requestCode(widgetId, KIND_DEST, index + 1)))
    return row
  }

  fun trip(context: Context, snap: JSONObject?, widgetId: Int, options: Bundle?, now: Long): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_trip)
    val labels = Labels(snap?.optJSONObject("labels"))
    val trip = snap?.optJSONObject("pinned")
    val departTs = trip?.optLongOrNull("departTs")
    val arriveTs = trip?.optLongOrNull("arriveTs")
    val phaseAt = journeyPhase(departTs, arriveTs, now)
    val scale = context.resources.configuration.fontScale.coerceAtLeast(1f)
    val height = heightDp(options, 200)
    val compact = height < 220 * scale
    val compressed = height < 150 * scale
    if (compressed) {
      val padding = (12 * context.resources.displayMetrics.density).toInt()
      views.setViewPadding(R.id.kw_content, padding, padding, padding, padding)
    }
    if (trip == null || departTs == null || arriveTs == null || phaseAt == null) {
      views.show(R.id.kw_content, false)
      views.show(R.id.kw_empty, true)
      views.show(R.id.kw_empty_body, !compressed)
      views.setTextViewText(R.id.kw_empty_title, labels.get("tripEmptyTitle") ?: context.getString(R.string.kw_trip_empty_title))
      views.setTextViewText(R.id.kw_empty_body, labels.get("tripEmptyBody") ?: context.getString(R.string.kw_trip_empty_body))
      views.setOnClickPendingIntent(android.R.id.background, openLink(context, FALLBACK_LINK, requestCode(widgetId, KIND_TRIP)))
      return views
    }
    views.show(R.id.kw_content, true)
    views.show(R.id.kw_empty, false)
    views.show(R.id.kw_trip_header, !compact)
    views.show(R.id.kw_sub, height >= 300 * scale)
    views.show(R.id.kw_trip_times, !compressed)
    views.show(R.id.kw_legs, !compact)
    views.show(R.id.kw_status, !compact)
    views.show(R.id.kw_progress, !compressed)
    views.setInt(R.id.kw_title, "setMaxLines", if (compact) 1 else 2)
    views.setInt(R.id.kw_phase, "setMaxLines", if (compressed) 1 else 2)
    views.setTextViewTextSize(R.id.kw_title, TypedValue.COMPLEX_UNIT_SP, if (compressed) 14f else 22f)
    views.setTextViewTextSize(R.id.kw_phase, TypedValue.COMPLEX_UNIT_SP, if (compressed) 18f else if (compact) 24f else 30f)
    views.setTextViewText(R.id.kw_title, trip.optString("toTitle"))
    views.setTextViewText(R.id.kw_sub, trip.optString("fromTitle"))
    views.setTextViewText(R.id.kw_trip_kind, labels.get("trackingTitle") ?: context.getString(R.string.kw_trip_label))
    views.setTextViewText(R.id.kw_depart, trip.optString("departAt").ifEmpty { clock(departTs) })
    views.setTextViewText(R.id.kw_arrive, trip.optString("arriveAt").ifEmpty { clock(arriveTs) })
    views.setTextViewText(R.id.kw_status, updated(labels, snap))
    views.setContentDescription(R.id.kw_search_action, labels.get("search") ?: context.getString(R.string.kw_search_hint))
    views.setOnClickPendingIntent(R.id.kw_search_action, openLink(context, SEARCH_LINK, requestCode(widgetId, KIND_TRIP, 15)))
    val phase: String
    val progress: Int
    when (phaseAt) {
      JourneyPhase.BEFORE -> {
        val m = minutesUntil(departTs, now)
        phase = when {
          m <= 0 -> labels.get("departNow") ?: ""
          m >= 60 -> labels.format("departAt", "t" to clock(departTs)) ?: clock(departTs)
          else -> labels.format("departIn", "n" to m.toString()) ?: ""
        }
        progress = 0
      }
      JourneyPhase.RIDING -> {
        phase = labels.format("arriveIn", "n" to minutesUntil(arriveTs, now).coerceAtLeast(1).toString()) ?: ""
        progress = (((now - departTs) * 1000L) / (arriveTs - departTs)).toInt().coerceIn(0, 1000)
      }
      JourneyPhase.ARRIVED -> {
        phase = labels.get("arrived") ?: ""
        progress = 1000
      }
    }
    views.setTextViewText(R.id.kw_phase, phase)
    views.setContentDescription(android.R.id.background,
      (listOf(trip.optString("fromTitle"), trip.optString("toTitle"), phase) +
        trip.optJSONArray("legs").objects().map { it.optString("line") }).filter { it.isNotBlank() }.joinToString(", "))
    views.setProgressBar(R.id.kw_progress, 1000, progress, false)
    views.removeAllViews(R.id.kw_legs)
    val legLimit = ((widthDp(options, 320) - 32) / (100 * scale)).toInt().coerceIn(1, 5)
    trip.optJSONArray("legs").objects().take(legLimit).forEachIndexed { index, leg ->
      if (index > 0) views.addView(R.id.kw_legs, RemoteViews(context.packageName, R.layout.kw_leg_sep))
      views.addView(R.id.kw_legs, lineBadge(context, leg.optString("mode"), leg.optString("line"), leg.optString("bg"), leg.optString("fg")))
    }
    views.setOnClickPendingIntent(android.R.id.background, openLink(context, trip.optString("deepLink"), requestCode(widgetId, KIND_TRIP)))
    return views
  }

  fun search(context: Context, snap: JSONObject?, widgetId: Int, options: Bundle?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_search)
    val labels = Labels(snap?.optJSONObject("labels"))
    val hint = labels.get("search") ?: context.getString(R.string.kw_search_hint)
    views.setTextViewText(R.id.kw_hint, hint)
    views.setContentDescription(R.id.kw_search, hint)
    views.setOnClickPendingIntent(R.id.kw_search, openLink(context, SEARCH_LINK, requestCode(widgetId, KIND_SEARCH)))
    views.removeAllViews(R.id.kw_places)
    val scale = context.resources.configuration.fontScale.coerceAtLeast(1f)
    val width = widthDp(options, 320)
    val paint = Paint().apply { textSize = 17f * scale }
    val searchWidth = paint.measureText(hint) + 76
    val slots = ((width - searchWidth) / 52).toInt().coerceIn(0, 2)
    snap?.optJSONArray("places").objects().take(slots).forEachIndexed { index, place ->
      val button = RemoteViews(context.packageName, R.layout.kw_place_button)
      button.setImageViewResource(R.id.kw_place_icon, placeIcon(place.optString("icon")))
      button.setContentDescription(R.id.kw_place, place.optString("name"))
      button.setOnClickPendingIntent(R.id.kw_place, openLink(context, place.optString("deepLink"), requestCode(widgetId, KIND_SEARCH, index + 1)))
      views.addView(R.id.kw_places, button)
    }
    return views
  }

  fun savedPlaces(context: Context, snap: JSONObject?, widgetId: Int, options: Bundle?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.kw_saved_places)
    val labels = Labels(snap?.optJSONObject("labels"))
    val places = snap?.optJSONArray("places").objects()
    val rowIds = intArrayOf(R.id.kw_saved_row_0, R.id.kw_saved_row_1, R.id.kw_saved_row_2)
    views.setOnClickPendingIntent(android.R.id.background, openLink(context, PLACES_LINK, requestCode(widgetId, KIND_SAVED)))
    rowIds.forEach { views.removeAllViews(it); views.show(it, false) }
    views.show(R.id.kw_saved_content, places.isNotEmpty())
    views.show(R.id.kw_saved_empty, places.isEmpty())
    val scale = context.resources.configuration.fontScale.coerceAtLeast(1f)
    val width = widthDp(options, 180)
    val height = heightDp(options, 180)
    views.show(R.id.kw_empty_icon, height >= 160 * scale)
    views.setTextViewText(R.id.kw_saved_empty_text, labels.get("addPlace") ?: context.getString(R.string.kw_add_place))
    if (places.isEmpty()) return views
    val columns = ((width - 16) / (144 * scale)).toInt().coerceIn(1, 3)
    val maxRows = ((height - 16) / (32 + 38 * scale)).toInt().coerceIn(1, 3)
    val visible = places.take(columns * maxRows)
    val rows = (visible.size + columns - 1) / columns
    for (rowIndex in 0 until rows) {
      val rowId = rowIds[rowIndex]
      views.show(rowId, true)
      for (column in 0 until columns) {
        val index = rowIndex * columns + column
        if (index >= visible.size) break
        val place = visible[index]
        val tile = RemoteViews(context.packageName, R.layout.kw_saved_place)
        val bg = when (index % 3) { 0 -> R.drawable.kw_target_featured; 1 -> R.drawable.kw_place_secondary; else -> R.drawable.kw_place_tertiary }
        val fg = context.getColor(when (index % 3) { 0 -> R.color.kw_on_primary_container; 1 -> R.color.kw_on_secondary_container; else -> R.color.kw_on_tertiary_container })
        tile.setInt(R.id.kw_saved_place, "setBackgroundResource", bg)
        tile.setInt(R.id.kw_saved_place_icon, "setColorFilter", fg)
        tile.setTextColor(R.id.kw_saved_place_name, fg)
        val showIcon = width / columns >= 144 * scale
        tile.show(R.id.kw_saved_place_icon, showIcon)
        val density = context.resources.displayMetrics.density
        tile.setViewPadding(R.id.kw_saved_place_name, if (showIcon) (10 * density).toInt() else 0, 0, 0, 0)
        if (!showIcon) {
          val padding = (8 * density).toInt()
          tile.setViewPadding(R.id.kw_saved_place, padding, padding, padding, padding)
        }
        tile.setImageViewResource(R.id.kw_saved_place_icon, placeIcon(place.optString("icon")))
        tile.setTextViewText(R.id.kw_saved_place_name, place.optString("name"))
        tile.setContentDescription(R.id.kw_saved_place, place.optString("name"))
        tile.setOnClickPendingIntent(R.id.kw_saved_place, openLink(context, place.optString("deepLink"), requestCode(widgetId, KIND_SAVED, index + 1)))
        views.addView(rowId, tile)
      }
    }
    return views
  }
}
