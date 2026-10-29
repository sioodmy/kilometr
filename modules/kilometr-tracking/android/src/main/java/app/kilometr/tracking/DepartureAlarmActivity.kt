package app.kilometr.tracking

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat
import org.json.JSONObject

class DepartureAlarmActivity : Activity() {
  private lateinit var data: JSONObject
  private lateinit var colors: JSONObject
  private val closed = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) { finish() }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val payload = DepartureAlarmStore.read(this)?.takeIf { it.optString("status") == "ringing" }
    if (payload == null) { finish(); return }
    data = payload
    colors = data.getJSONObject("colors")
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    ContextCompat.registerReceiver(this, closed, IntentFilter(DepartureAlarmStore.CLOSE), ContextCompat.RECEIVER_NOT_EXPORTED)
    render()
  }

  private fun color(key: String) = Color.parseColor(colors.getString(key))
  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
  private fun rounded(key: String, radius: Int) = GradientDrawable().apply {
    setColor(color(key))
    cornerRadius = dp(radius).toFloat()
  }

  private fun text(value: String, size: Float, key: String, weight: Int = 400): TextView = TextView(this).apply {
    text = value
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    setTextColor(color(key))
    gravity = Gravity.CENTER
    includeFontPadding = false
    typeface = if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.create("sans-serif", Typeface.NORMAL), weight, false)
      else Typeface.create("sans-serif", if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
  }

  private fun LinearLayout.add(view: View, top: Int = 0, height: Int = ViewGroup.LayoutParams.WRAP_CONTENT) {
    addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height).apply { topMargin = dp(top) })
  }

  private fun button(label: String, primary: Boolean, action: () -> Unit): TextView =
    text(label, 18f, if (primary) "onPrimary" else "onSurface", 600).apply {
      minHeight = dp(if (primary) 72 else 56)
      setPadding(dp(20), dp(16), dp(20), dp(16))
      val bg = rounded(if (primary) "primary" else "surfaceContainerHigh", if (primary) 28 else 20)
      background = RippleDrawable(ColorStateList.valueOf(color(if (primary) "onPrimary" else "primary") and 0x33ffffff), bg, null)
      isClickable = true
      isFocusable = true
      accessibilityDelegate = object : View.AccessibilityDelegate() {
        override fun onInitializeAccessibilityNodeInfo(host: View, info: android.view.accessibility.AccessibilityNodeInfo) {
          super.onInitializeAccessibilityNodeInfo(host, info)
          info.className = "android.widget.Button"
        }
      }
      setOnClickListener { action() }
    }

  private fun render() {
    val labels = data.getJSONObject("labels")
    window.statusBarColor = color("surface")
    window.navigationBarColor = color("surface")
    window.decorView.systemUiVisibility = 0

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(color("surface"))
      setPadding(dp(24), dp(24), dp(24), dp(24))
      setOnApplyWindowInsetsListener { view, insets ->
        if (Build.VERSION.SDK_INT >= 30) {
          val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
          view.setPadding(dp(24) + bars.left, dp(16) + bars.top, dp(24) + bars.right, dp(16) + bars.bottom)
        }
        insets
      }
    }
    val scroll = ScrollView(this).apply { isFillViewport = true; isVerticalScrollBarEnabled = false }
    val content = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(0, dp(12), 0, dp(32))
    }
    val icon = ImageView(this).apply {
      setImageResource(app.kilometr.tracking.R.drawable.ic_kilometr_alarm)
      imageTintList = ColorStateList.valueOf(color("onPrimaryContainer"))
      background = rounded("primaryContainer", 28)
      setPadding(dp(18), dp(18), dp(18), dp(18))
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    content.addView(icon, LinearLayout.LayoutParams(dp(80), dp(80)).apply { bottomMargin = dp(20) })
    content.add(text(labels.getString("title"), 16f, "onSurfaceVariant", 500))
    content.add(text(labels.getString("ringTitle"), 32f, "onSurface", 600), 20)
    val clock = text(data.getString("time"), 96f, "primary", 500).apply {
      letterSpacing = -0.05f
      fontFeatureSettings = "tnum"
      if (Build.VERSION.SDK_INT >= 26) setAutoSizeTextTypeUniformWithConfiguration(32, 96, 1, TypedValue.COMPLEX_UNIT_SP)
    }
    content.add(clock, 16, dp(130))
    content.add(text(data.getString("date"), 16f, "onSurfaceVariant"), 4)

    val journey = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = rounded("surfaceContainerHigh", 28)
      setPadding(dp(24), dp(24), dp(24), dp(24))
    }
    journey.add(text(data.getJSONObject("connection").getString("fromTitle"), 14f, "onSurfaceVariant"))
    journey.add(text(data.getJSONObject("connection").getString("toTitle"), 24f, "onSurface", 600), 8)
    journey.add(text(data.getString("journeyLabel"), 16f, "onSurface", 500), 20)
    journey.add(text(data.getString("boardingLabel"), 14f, "onSurfaceVariant"), 8)
    content.add(journey, 32)
    scroll.addView(content)
    root.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    root.add(button(labels.getString("dismiss"), true) { DepartureAlarmStore.cancel(this); finish() })
    root.add(button(labels.getString("showRoute"), false) {
      DepartureAlarmStore.cancel(this)
      startActivity(DepartureAlarmStore.routeIntent(this, data))
      finish()
    }, 12)
    setContentView(root)
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    DepartureAlarmStore.cancel(this)
    super.onBackPressed()
  }

  override fun onDestroy() {
    if (::data.isInitialized) unregisterReceiver(closed)
    super.onDestroy()
  }
}
