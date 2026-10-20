package app.kilometr.widgets;

import static org.junit.Assert.*;

import android.app.Application;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.view.ViewGroup;
import android.widget.RemoteViews;
import android.widget.TextView;
import androidx.core.graphics.ColorUtils;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34, qualifiers = "mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class WidgetRenderTest {
  private final Context context = RuntimeEnvironment.getApplication();
  private final long now = 1_792_499_400_000L;

  private JSONObject snapshot() throws Exception {
    JSONObject labels = new JSONObject()
      .put("nextTitle", "Czas wyjść").put("journeyTitle", "Twoje kierunki")
      .put("trackingTitle", "Twoja podróż").put("fromOrigin", "Z: {name}")
      .put("departIn", "Wyjdź za {n} min").put("departAt", "wyjście {t}")
      .put("departNow", "Czas wyjść").put("arriveIn", "przyjazd za {n} min")
      .put("arrived", "Na miejscu").put("now", "teraz").put("min", "min")
      .put("updated", "stan z {t}").put("checkRoutes", "Sprawdź połączenia")
      .put("search", "Dokąd jedziesz?").put("stale", "Sprawdź kolejne połączenie")
      .put("nextEmpty", "Sprawdź kolejne połączenie").put("addPlace", "Dodaj miejsce");
    JSONObject item = new JSONObject().put("title", "Dom").put("dest", "Dom").put("icon", "home")
      .put("line", "17").put("mode", "tram").put("lineBg", "#00695C").put("lineFg", "#FFFFFF")
      .put("departTs", now + 300_000).put("departAt", "14:35").put("deepLink", "kilometr://routes?toTitle=Dom");
    JSONObject second = new JSONObject(item.toString()).put("title", "Politechnika").put("dest", "Politechnika")
      .put("icon", "school").put("line", "146").put("mode", "bus").put("lineBg", "#1976D2")
      .put("departTs", now + 720_000).put("departAt", "14:42").put("deepLink", "kilometr://routes?toTitle=Politechnika");
    JSONArray places = new JSONArray()
      .put(new JSONObject().put("name", "Dom").put("icon", "home").put("deepLink", "kilometr://routes?toTitle=Dom"))
      .put(new JSONObject().put("name", "Politechnika").put("icon", "school").put("deepLink", "kilometr://routes?toTitle=Politechnika"));
    return new JSONObject().put("labels", labels).put("updatedAt", now).put("origin", "Inżynierska")
      .put("next", new JSONArray().put(item).put(second)).put("quick", new JSONArray().put(item).put(second))
      .put("places", places).put("pinned", new JSONObject().put("fromTitle", "Inżynierska").put("toTitle", "Politechnika")
        .put("departTs", now - 600_000).put("arriveTs", now + 720_000).put("departAt", "14:20").put("arriveAt", "14:42")
        .put("deepLink", "kilometr://routes?toTitle=Politechnika")
        .put("legs", new JSONArray().put(new JSONObject().put("mode", "tram").put("line", "17").put("bg", "#00695C").put("fg", "#FFFFFF"))));
  }

  private Bundle size(int width, int height) {
    Bundle options = new Bundle();
    options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, width);
    options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, height);
    return options;
  }

  private View apply(Context ctx, RemoteViews remote, int width, int height) {
    View view = remote.apply(ctx, null);
    view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
    view.layout(0, 0, width, height);
    return view;
  }

  private String text(View root, int id) { return ((TextView) root.findViewById(id)).getText().toString(); }
  private Intent nextIntent() { return Shadows.shadowOf((Application) context).getNextStartedActivity(); }

  @Test public void destinationsStayAvailableDuringTrackedTrip() throws Exception {
    View view = apply(context, WidgetRenderers.INSTANCE.destinations(context, snapshot(), 1, size(320, 260), now), 320, 260);
    assertEquals("Dom", text(view, R.id.kw_row_title));
    assertEquals(2, ((ViewGroup) view.findViewById(R.id.kw_rows)).getChildCount());
    assertEquals("Z: Inżynierska", text(view, R.id.kw_origin));
  }

  @Test public void tripShowsEachPhaseAndClearsAfterArrival() throws Exception {
    JSONObject snap = snapshot();
    for (long[] phase : new long[][] {{now - 900_000, 0}, {now, 1}, {now + 720_000, 2}, {now + 840_001, 3}}) {
      View view = apply(context, WidgetRenderers.INSTANCE.trip(context, snap, 1, size(320, 260), phase[0]), 320, 260);
      if (phase[1] == 0) assertEquals("Wyjdź za 5 min", text(view, R.id.kw_phase));
      if (phase[1] == 1) assertEquals("przyjazd za 12 min", text(view, R.id.kw_phase));
      if (phase[1] == 2) assertEquals("Na miejscu", text(view, R.id.kw_phase));
      if (phase[1] == 3) assertEquals(View.VISIBLE, view.findViewById(R.id.kw_empty).getVisibility());
    }
  }

  @Test public void nextSelectsEarliestUpcomingAndDoesNotKeepExpiredCountdown() throws Exception {
    JSONObject snap = snapshot();
    JSONArray items = snap.getJSONArray("next");
    snap.put("next", new JSONArray().put(items.getJSONObject(1)).put(items.getJSONObject(0)));
    View next = apply(context, WidgetRenderers.INSTANCE.next(context, snap, 1, size(180, 180), now), 180, 180);
    assertEquals("5", text(next, R.id.kw_big));
    assertEquals("Dom", text(next, R.id.kw_title));
    View expired = apply(context, WidgetRenderers.INSTANCE.next(context, snap, 1, size(180, 180), now + 900_000), 180, 180);
    assertEquals(View.GONE, expired.findViewById(R.id.kw_content).getVisibility());
    assertEquals(View.VISIBLE, expired.findViewById(R.id.kw_empty).getVisibility());
  }

  @Test public void actualLauncherSizesDriveLayouts() {
    Bundle options = size(160, 110);
    options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 320);
    options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 320);
    options.putParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES,
      new ArrayList<>(Arrays.asList(new SizeF(160, 320), new SizeF(320, 110))));
    List<String> rendered = new ArrayList<>();
    KilometrWidgetsKt.sizedViews(options, exact -> {
      rendered.add(exact.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) + "x" + exact.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT));
      return new RemoteViews(context.getPackageName(), R.layout.kw_next);
    });
    assertEquals(Arrays.asList("160x320", "320x110"), rendered);
  }

  @Test @Config(sdk = 30) public void legacyLauncherPairsPortraitAndLandscapeDimensions() {
    Bundle options = size(160, 110);
    options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 320);
    options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 320);
    List<String> rendered = new ArrayList<>();
    KilometrWidgetsKt.sizedViews(options, exact -> {
      rendered.add(exact.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) + "x" + exact.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT));
      return new RemoteViews(context.getPackageName(), R.layout.kw_next);
    });
    assertEquals(Arrays.asList("320x110", "160x320"), rendered);
  }

  private void checkBounds(View view, int x, int y, int width, int height) {
    if (view.getVisibility() != View.VISIBLE) return;
    int left = x + view.getLeft(), top = y + view.getTop();
    if (view instanceof TextView) {
      TextView label = (TextView) view;
      if (label.getText().length() > 0) {
        String message = label.getText() + " at " + left + "," + top + " " + view.getWidth() + "x" + view.getHeight() + " in " + width + "x" + height;
        assertTrue(message, view.getWidth() > 0 && view.getHeight() > 0);
        assertTrue(message, top >= 0 && top + view.getHeight() <= height && left >= 0 && left + view.getWidth() <= width);
        if (label.getLayout() != null) {
          int textHeight = label.getLayout().getLineBottom(label.getLayout().getLineCount() - 1);
          assertTrue("Clipped glyphs: " + message + " textHeight=" + textHeight,
            textHeight <= label.getHeight() - label.getCompoundPaddingTop() - label.getCompoundPaddingBottom());
        }
      }
    }
    if (view instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) view;
      for (int i = 0; i < group.getChildCount(); i++) checkBounds(group.getChildAt(i), left, top, width, height);
    }
  }

  @Test public void contentAndEmptyStatesFitAtLargeFontSizes() throws Exception {
    List<String> failures = new ArrayList<>();
    for (float scale : new float[] {1f, 1.3f, 2f}) {
      Configuration config = new Configuration(context.getResources().getConfiguration());
      config.fontScale = scale;
      Context scaled = context.createConfigurationContext(config);
      for (int[] dim : new int[][] {{110,110}, {160,160}, {180,240}, {220,110}, {280,200}, {320,320}}) {
        for (JSONObject snap : new JSONObject[] {null, snapshot()}) {
          List<RemoteViews> widgets = new ArrayList<>();
          widgets.add(WidgetRenderers.INSTANCE.next(scaled, snap, 1, size(dim[0], dim[1]), now));
          widgets.add(WidgetRenderers.INSTANCE.savedPlaces(scaled, snap, 1, size(dim[0], dim[1])));
          if (dim[0] >= 220) {
            widgets.add(WidgetRenderers.INSTANCE.destinations(scaled, snap, 1, size(dim[0], dim[1]), now));
            widgets.add(WidgetRenderers.INSTANCE.trip(scaled, snap, 1, size(dim[0], dim[1]), now));
          }
          for (RemoteViews widget : widgets) {
            try {
              checkBounds(apply(scaled, widget, dim[0], dim[1]), 0, 0, dim[0], dim[1]);
            } catch (AssertionError failure) {
              failures.add("scale=" + scale + " empty=" + (snap == null) + ": " + failure.getMessage());
            }
          }
        }
      }
      for (int width : new int[] {180, 240, 320, 400}) {
        try {
          checkBounds(apply(scaled, WidgetRenderers.INSTANCE.search(scaled, snapshot(), 1, size(width, 56)), width, 56), 0, 0, width, 56);
        } catch (AssertionError failure) {
          failures.add("search scale=" + scale + ": " + failure.getMessage());
        }
      }
    }
    assertTrue(String.join("\n", failures), failures.isEmpty());
  }

  @Test @Config(sdk = {30, 34}) public void everyThemeHasReadableColorPairs() {
    int[][] pairs = {
      {R.color.kw_on_surface, R.color.kw_surface}, {R.color.kw_on_surface, R.color.kw_surface_high},
      {R.color.kw_on_surface_variant, R.color.kw_surface}, {R.color.kw_primary, R.color.kw_surface},
      {R.color.kw_on_primary, R.color.kw_primary}, {R.color.kw_on_primary_container, R.color.kw_primary_container},
      {R.color.kw_on_secondary_container, R.color.kw_secondary_container}, {R.color.kw_on_tertiary_container, R.color.kw_tertiary_container}
    };
    for (int mode : new int[] {Configuration.UI_MODE_NIGHT_NO, Configuration.UI_MODE_NIGHT_YES}) {
      Configuration config = new Configuration(context.getResources().getConfiguration());
      config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | mode;
      Context themed = context.createConfigurationContext(config);
      for (int[] pair : pairs) {
        double ratio = ColorUtils.calculateContrast(themed.getColor(pair[0]), themed.getColor(pair[1]));
        assertTrue(themed.getResources().getResourceEntryName(pair[0]) + " ratio=" + ratio + " mode=" + mode, ratio >= 4.5);
      }
    }
  }

  @Test public void lineBadgesKeepContrast() {
    for (String hex : new String[] {"#F57C00", "#1976D2", "#00897B", "#BB0000"}) {
      View badge = apply(context, WidgetPartsKt.lineBadge(context, "tram", "4", hex, "#FFFFFF"), 120, 32);
      int color = ((TextView) badge.findViewById(R.id.kw_badge_text)).getCurrentTextColor();
      assertTrue(ColorUtils.calculateContrast(color, android.graphics.Color.parseColor(hex)) >= 4.5);
    }
  }

  @Test public void eachActionOpensItsOwnDestination() throws Exception {
    JSONObject snap = snapshot();
    View directions = apply(context, WidgetRenderers.INSTANCE.destinations(context, snap, 1, size(320, 320), now), 320, 320);
    ViewGroup rows = directions.findViewById(R.id.kw_rows);
    for (int i = 0; i < rows.getChildCount(); i++) {
      assertTrue(rows.getChildAt(i).performClick());
      assertEquals(i == 0 ? "Dom" : "Politechnika", nextIntent().getData().getQueryParameter("toTitle"));
    }
    assertTrue(directions.findViewById(R.id.kw_refresh_action).performClick());
    assertEquals("kilometr://", nextIntent().getData().toString());
    View places = apply(context, WidgetRenderers.INSTANCE.savedPlaces(context, snap, 2, size(180, 180)), 180, 180);
    assertTrue(places.findViewById(R.id.kw_saved_place).performClick());
    assertEquals("Dom", nextIntent().getData().getQueryParameter("toTitle"));
    View search = apply(context, WidgetRenderers.INSTANCE.search(context, snap, 3, size(400, 56)), 400, 56);
    assertTrue(search.findViewById(R.id.kw_search).performClick());
    assertEquals("1", nextIntent().getData().getQueryParameter("search"));
    assertTrue(search.findViewById(R.id.kw_place).performClick());
    assertEquals("Dom", nextIntent().getData().getQueryParameter("toTitle"));
    View next = apply(context, WidgetRenderers.INSTANCE.next(context, snap, 4, size(180, 180), now), 180, 180);
    assertTrue(next.performClick());
    assertEquals("Dom", nextIntent().getData().getQueryParameter("toTitle"));
    View trip = apply(context, WidgetRenderers.INSTANCE.trip(context, snap, 5, size(320, 240), now), 320, 240);
    assertTrue(trip.performClick());
    assertEquals("Politechnika", nextIntent().getData().getQueryParameter("toTitle"));
    View empty = apply(context, WidgetRenderers.INSTANCE.savedPlaces(context, null, 6, size(180, 180)), 180, 180);
    assertTrue(empty.performClick());
    assertEquals("1", nextIntent().getData().getQueryParameter("places"));
  }

  @Test public void renderCollectionForVisualReview() throws Exception {
    String directory = System.getProperty("kilometr.widget.screenshots");
    if (directory == null) return;
    new File(directory).mkdirs();
    for (boolean night : new boolean[] {false, true}) {
      Configuration config = new Configuration(context.getResources().getConfiguration());
      config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | (night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
      Context themed = context.createConfigurationContext(config);
      JSONObject snap = snapshot();
      RemoteViews[] widgets = {
        WidgetRenderers.INSTANCE.next(themed, snap, 1, size(180, 180), now),
        WidgetRenderers.INSTANCE.savedPlaces(themed, snap, 2, size(180, 180)),
        WidgetRenderers.INSTANCE.destinations(themed, snap, 3, size(372, 272), now),
        WidgetRenderers.INSTANCE.trip(themed, snap, 4, size(372, 180), now),
        WidgetRenderers.INSTANCE.search(themed, snap, 5, size(372, 64))
      };
      int[][] sizes = {{180,180},{180,180},{372,272},{372,180},{372,64}};
      for (int i = 0; i < widgets.length; i++) {
        View view = apply(themed, widgets[i], sizes[i][0], sizes[i][1]);
        Bitmap bitmap = Bitmap.createBitmap(sizes[i][0] * 3, sizes[i][1] * 3, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.scale(3, 3);
        view.draw(canvas);
        try (FileOutputStream stream = new FileOutputStream(new File(directory, (night ? "dark" : "light") + "-" + i + ".png"))) {
          assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream));
        }
        bitmap.recycle();
      }
    }
  }
}
