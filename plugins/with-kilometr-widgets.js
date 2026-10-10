// Config plugin: natywne widgety z ekranu głównego (Android AppWidgetProvider).
// Działa tylko w dev-build APK (nix run .#build-apk) — NIE w Expo Go.
//
// 3 widgety, wszystkie czytają snapshot pisany przez apkę
// (src/services/widgetSnapshot.ts → filesDir/kilometr-widget.json):
//   - NextWidgetProvider   (4x1): najbliższy odjazd — linia, cel, "za X min"
//   - PinnedWidgetProvider (4x2): przypięte połączenie — trasa, godziny, status
//   - QuickWidgetProvider  (4x3): 3 szybkie cele, każdy wiersz klikalny
// Tap otwiera apkę przez deep link kilometr://routes?... (ekran połączeń).
// Odświeżenie: updatePeriodMillis (min. 30 min, wymusza system) + świeży
// snapshot po każdym otwarciu apki.

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const WIDGET_UPDATE_ACTION = 'android.appwidget.action.APPWIDGET_UPDATE';

const PROVIDERS = [
  { className: 'NextWidgetProvider', infoXml: 'widget_next_info' },
  { className: 'PinnedWidgetProvider', infoXml: 'widget_pinned_info' },
  { className: 'QuickWidgetProvider', infoXml: 'widget_quick_info' },
];

function withWidgetReceivers(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0];
    app.receiver = app.receiver || [];
    for (const p of PROVIDERS) {
      const name = `.${p.className}`;
      if (app.receiver.some((r) => r.$ && r.$['android:name'] === name)) continue;
      app.receiver.push({
        $: { 'android:name': name, 'android:enabled': 'true', 'android:exported': 'false' },
        'intent-filter': [{ action: [{ $: { 'android:name': WIDGET_UPDATE_ACTION } }] }],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': `@xml/${p.infoXml}`,
            },
          },
        ],
      });
    }
    return config;
  });
}

function withWidgetFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const root = config.modRequest.platformProjectRoot;
      const pkg = (config.android && config.android.package) || 'com.anonymous.kilometr';
      const javaDir = path.join(root, 'app/src/main/java', ...pkg.split('.'));
      const resDir = path.join(root, 'app/src/main/res');
      fs.mkdirSync(javaDir, { recursive: true });
      fs.mkdirSync(path.join(resDir, 'xml'), { recursive: true });
      fs.mkdirSync(path.join(resDir, 'layout'), { recursive: true });
      fs.mkdirSync(path.join(resDir, 'values'), { recursive: true });
      fs.mkdirSync(path.join(resDir, 'drawable'), { recursive: true });

      fs.writeFileSync(
        path.join(javaDir, 'KilometrWidgets.kt'),
        kotlinSource(pkg),
      );
      for (const [name, content] of Object.entries(resFiles())) {
        fs.writeFileSync(path.join(resDir, name), content);
      }
      return config;
    },
  ]);
}

function resFiles() {
  return {
    'xml/widget_next_info.xml': widgetInfoXml('widget_next', 250, 40, 4, 1, 'kilometr_widget_next_desc'),
    'xml/widget_pinned_info.xml': widgetInfoXml('widget_pinned', 250, 110, 4, 2, 'kilometr_widget_pinned_desc'),
    'xml/widget_quick_info.xml': widgetInfoXml('widget_quick', 250, 180, 4, 3, 'kilometr_widget_quick_desc'),
    'values/kilometr_widgets.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="kilometr_widget_next_label">Kilometr: odjazd</string>
    <string name="kilometr_widget_next_desc">Najbliższy odjazd MPK</string>
    <string name="kilometr_widget_pinned_label">Kilometr: przypięte</string>
    <string name="kilometr_widget_pinned_desc">Przypięte połączenie MPK</string>
    <string name="kilometr_widget_quick_label">Kilometr: szybkie cele</string>
    <string name="kilometr_widget_quick_desc">Szybkie cele z odjazdami</string>
</resources>
`,
    'drawable/widget_bg.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <corners android:radius="28dp" />
    <solid android:color="#1B2120" />
</shape>
`,
    'drawable/widget_dot.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <solid android:color="#FFFFFF" />
</shape>
`,
    'layout/widget_next.xml': `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg"
    android:gravity="center_vertical"
    android:orientation="horizontal"
    android:padding="14dp">
    <ImageView
        android:id="@+id/lineDot"
        android:layout_width="12dp"
        android:layout_height="12dp"
        android:src="@drawable/widget_dot" />
    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginStart="10dp"
        android:layout_weight="1"
        android:orientation="vertical">
        <TextView
            android:id="@+id/title"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:ellipsize="end"
            android:maxLines="1"
            android:textColor="#E0E3E1"
            android:textSize="15sp"
            android:textStyle="bold" />
        <TextView
            android:id="@+id/subtitle"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:ellipsize="end"
            android:maxLines="1"
            android:textColor="#BFC9C5"
            android:textSize="12sp" />
    </LinearLayout>
    <TextView
        android:id="@+id/big"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginStart="8dp"
        android:textColor="#E0E3E1"
        android:textSize="20sp"
        android:textStyle="bold" />
</LinearLayout>
`,
    'layout/widget_pinned.xml': `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg"
    android:gravity="center_vertical"
    android:orientation="vertical"
    android:padding="14dp">
    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Kilometr • Przypięte"
        android:textColor="#5CDBBE"
        android:textSize="11sp"
        android:textStyle="bold" />
    <TextView
        android:id="@+id/title"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="4dp"
        android:ellipsize="end"
        android:maxLines="1"
        android:textColor="#E0E3E1"
        android:textSize="15sp"
        android:textStyle="bold" />
    <TextView
        android:id="@+id/big"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="2dp"
        android:textColor="#E0E3E1"
        android:textSize="20sp"
        android:textStyle="bold" />
    <TextView
        android:id="@+id/subtitle"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:ellipsize="end"
        android:maxLines="1"
        android:textColor="#BFC9C5"
        android:textSize="12sp" />
</LinearLayout>
`,
    'layout/widget_quick.xml': `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/widget_bg"
    android:gravity="center_vertical"
    android:orientation="vertical"
    android:padding="14dp">
    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Kilometr • Szybkie cele"
        android:textColor="#5CDBBE"
        android:textSize="11sp"
        android:textStyle="bold" />
    <LinearLayout
        android:id="@+id/row0"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingVertical="5dp">
        <TextView
            android:id="@+id/row0Title"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:ellipsize="end"
            android:maxLines="1"
            android:textColor="#E0E3E1"
            android:textSize="14sp" />
        <TextView
            android:id="@+id/row0Time"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginStart="8dp"
            android:textColor="#5CDBBE"
            android:textSize="14sp"
            android:textStyle="bold" />
    </LinearLayout>
    <LinearLayout
        android:id="@+id/row1"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingVertical="5dp">
        <TextView
            android:id="@+id/row1Title"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:ellipsize="end"
            android:maxLines="1"
            android:textColor="#E0E3E1"
            android:textSize="14sp" />
        <TextView
            android:id="@+id/row1Time"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginStart="8dp"
            android:textColor="#5CDBBE"
            android:textSize="14sp"
            android:textStyle="bold" />
    </LinearLayout>
    <LinearLayout
        android:id="@+id/row2"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:gravity="center_vertical"
        android:orientation="horizontal"
        android:paddingVertical="5dp">
        <TextView
            android:id="@+id/row2Title"
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:ellipsize="end"
            android:maxLines="1"
            android:textColor="#E0E3E1"
            android:textSize="14sp" />
        <TextView
            android:id="@+id/row2Time"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginStart="8dp"
            android:textColor="#5CDBBE"
            android:textSize="14sp"
            android:textStyle="bold" />
    </LinearLayout>
</LinearLayout>
`,
  };
}

function widgetInfoXml(layout, minW, minH, cellsW, cellsH, desc) {
  return `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="${minW}dp"
    android:minHeight="${minH}dp"
    android:targetCellWidth="${cellsW}"
    android:targetCellHeight="${cellsH}"
    android:updatePeriodMillis="1800000"
    android:initialLayout="@layout/${layout}"
    android:description="@string/${desc}"
    android:widgetCategory="home_screen"
    android:resizeMode="horizontal" />
`;
}

// Wiersze widgetu "szybkie cele" mają jawne unikalne id (row0..2) —
// <include> z powtarzanymi id dzieci nie działa z RemoteViews
// (setTextViewText trafiłby we wszystkie kopie naraz).

function kotlinSource(pkg) {
  return `package ${pkg}

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.io.File

// Snapshot pisany przez apkę (filesDir/kilometr-widget.json).
// Pola: updatedAt, next{line,lineColor,dest,departInMin,departAt,delayMin,live,deepLink},
// pinned{fromTitle,toTitle,departAt?,arriveAt?,durationMin?,delayMin?,live?,deepLink},
// quick[{id,title,departInMin?,deepLink}].

private const val SNAPSHOT_FILE = "kilometr-widget.json"
private const val FALLBACK_LINK = "kilometr://"

private fun readSnapshot(context: Context): JSONObject? {
    return try {
        val f = File(context.filesDir, SNAPSHOT_FILE)
        if (!f.exists()) return null
        JSONObject(f.bufferedReader().use { it.readText() })
    } catch (_: Exception) {
        null
    }
}

private fun activityIntent(context: Context, link: String, requestCode: Int): PendingIntent {
    val uri = try {
        Uri.parse(if (link.isBlank()) FALLBACK_LINK else link)
    } catch (_: Exception) {
        Uri.parse(FALLBACK_LINK)
    }
    val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    var flags = PendingIntent.FLAG_UPDATE_CURRENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        flags = flags or PendingIntent.FLAG_IMMUTABLE
    }
    return PendingIntent.getActivity(context, requestCode, intent, flags)
}

private fun departLabel(departInMin: Int, departAt: String): String {
    if (departInMin <= 1) return "za chwilę"
    if (departInMin > 59) return departAt
    return "za $departInMin min"
}

private fun statusText(delayMin: Int, live: Boolean): Pair<String, Int> {
    if (live && delayMin > 0) return "+$delayMin min" to Color.parseColor("#FFB4AB")
    if (live) return "Na czas" to Color.parseColor("#7DD895")
    return "Rozkład" to Color.parseColor("#BFC9C5")
}

private fun lineColor(hex: String): Int {
    return try {
        Color.parseColor(hex)
    } catch (_: Exception) {
        Color.parseColor("#5CDBBE")
    }
}

private fun updateOne(
    context: Context,
    manager: AppWidgetManager,
    widgetId: Int,
    views: RemoteViews,
) {
    try {
        manager.updateAppWidget(widgetId, views)
    } catch (_: Exception) {
    }
}

class NextWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val snap = readSnapshot(context)
        val next = snap?.optJSONObject("next")
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_next)
            if (next == null) {
                views.setTextViewText(R.id.title, "Brak danych")
                views.setTextViewText(R.id.subtitle, "Otwórz Kilometr, by odświeżyć")
                views.setTextViewText(R.id.big, "")
                views.setOnClickPendingIntent(R.id.root, activityIntent(context, FALLBACK_LINK, id))
            } else {
                val line = next.optString("line", "•")
                val dest = next.optString("dest", "")
                val departInMin = next.optInt("departInMin", -1)
                val departAt = next.optString("departAt", "")
                val delayMin = next.optInt("delayMin", 0)
                val live = next.optBoolean("live", false)
                val link = next.optString("deepLink", FALLBACK_LINK)
                val (status, statusColor) = statusText(delayMin, live)
                views.setTextViewText(R.id.title, "$line → $dest")
                views.setTextViewText(R.id.subtitle, status)
                views.setTextColor(R.id.subtitle, statusColor)
                views.setTextViewText(
                    R.id.big,
                    if (departInMin >= 0) departLabel(departInMin, departAt) else departAt,
                )
                try {
                    views.setInt(R.id.lineDot, "setColorFilter", lineColor(next.optString("lineColor", "")))
                } catch (_: Exception) {
                }
                views.setOnClickPendingIntent(R.id.root, activityIntent(context, link, id))
            }
            updateOne(context, manager, id, views)
        }
    }
}

class PinnedWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val pinned = readSnapshot(context)?.optJSONObject("pinned")
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_pinned)
            if (pinned == null) {
                views.setTextViewText(R.id.title, "Nic nie przypięto")
                views.setTextViewText(R.id.big, "")
                views.setTextViewText(R.id.subtitle, "Przypnij połączenie w aplikacji")
                views.setOnClickPendingIntent(R.id.root, activityIntent(context, FALLBACK_LINK, id))
            } else {
                val from = pinned.optString("fromTitle", "")
                val to = pinned.optString("toTitle", "")
                val link = pinned.optString("deepLink", FALLBACK_LINK)
                views.setTextViewText(R.id.title, "$from → $to")
                if (pinned.has("departAt")) {
                    val departAt = pinned.optString("departAt", "")
                    val arriveAt = pinned.optString("arriveAt", "")
                    val durationMin = pinned.optInt("durationMin", 0)
                    val delayMin = pinned.optInt("delayMin", 0)
                    val live = pinned.optBoolean("live", false)
                    val (status, statusColor) = statusText(delayMin, live)
                    views.setTextViewText(R.id.big, "$departAt – $arriveAt")
                    views.setTextViewText(
                        R.id.subtitle,
                        if (durationMin > 0) "$durationMin min • $status" else status,
                    )
                    views.setTextColor(R.id.subtitle, statusColor)
                } else {
                    views.setTextViewText(R.id.big, "")
                    views.setTextViewText(R.id.subtitle, "Otwórz, by zobaczyć godziny")
                }
                views.setOnClickPendingIntent(R.id.root, activityIntent(context, link, id))
            }
            updateOne(context, manager, id, views)
        }
    }
}

class QuickWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val snap = readSnapshot(context)
        val rowRoots = intArrayOf(R.id.row0, R.id.row1, R.id.row2)
        val rowTitles = intArrayOf(R.id.row0Title, R.id.row1Title, R.id.row2Title)
        val rowTimes = intArrayOf(R.id.row0Time, R.id.row1Time, R.id.row2Time)
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_quick)
            views.setOnClickPendingIntent(R.id.root, activityIntent(context, FALLBACK_LINK, id * 10))
            val arr = snap?.optJSONArray("quick")
            val count = arr?.length() ?: 0
            for (row in 0 until 3) {
                if (row < count) {
                    val item = arr!!.optJSONObject(row)
                    if (item == null) {
                        // Element nie jest obiektem (np. null w tablicy) — chowamy
                        // wiersz zamiast wywalać NPE w procesie aplikacji.
                        views.setViewVisibility(rowRoots[row], View.GONE)
                        continue
                    }
                    val title = item.optString("title", "")
                    val departInMin = if (item.has("departInMin")) item.optInt("departInMin", -1) else -1
                    val link = item.optString("deepLink", FALLBACK_LINK)
                    views.setViewVisibility(rowRoots[row], View.VISIBLE)
                    views.setTextViewText(rowTitles[row], title)
                    views.setTextViewText(
                        rowTimes[row],
                        if (departInMin >= 0) departLabel(departInMin, "") else "—",
                    )
                    // Każdy wiersz ma własne stabilne id — osobny deep link do celu.
                    views.setOnClickPendingIntent(
                        rowRoots[row],
                        activityIntent(context, link, id * 10 + row + 1),
                    )
                } else {
                    views.setViewVisibility(rowRoots[row], View.GONE)
                }
            }
            if (count == 0) {
                views.setViewVisibility(R.id.row0, View.VISIBLE)
                views.setTextViewText(R.id.row0Title, "Brak szybkich celów")
                views.setTextViewText(R.id.row0Time, "")
                views.setViewVisibility(R.id.row1, View.GONE)
                views.setViewVisibility(R.id.row2, View.GONE)
            }
            updateOne(context, manager, id, views)
        }
    }
}
`;
}

module.exports = function withKilometrWidgets(config) {
  config = withWidgetReceivers(config);
  config = withWidgetFiles(config);
  return config;
};
module.exports.withWidgetReceivers = withWidgetReceivers;
module.exports.withWidgetFiles = withWidgetFiles;
