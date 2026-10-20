package app.kilometr.predictiveback

import android.os.Build
import androidx.activity.ComponentActivity
import com.facebook.react.bridge.UiThreadUtil
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PredictiveBackModule : Module() {
    private var controller: PredictiveBackController? = null
    private var enabled = false

    override fun definition() = ModuleDefinition {
        Name("KilometrPredictiveBack")

        AsyncFunction("setEnabled") { value: Boolean ->
            enabled = value
            updateController()
        }.runOnQueue(Queues.MAIN)

        OnActivityEntersForeground {
            UiThreadUtil.runOnUiThread { updateController() }
        }

        OnActivityEntersBackground {
            UiThreadUtil.runOnUiThread { controller?.cancelPreview() }
        }

        OnActivityDestroys {
            UiThreadUtil.runOnUiThread { disposeController() }
        }

        OnDestroy {
            UiThreadUtil.runOnUiThread { disposeController() }
        }
    }

    private fun updateController() {
        if (Build.VERSION.SDK_INT < 34) return
        val activity = appContext.currentActivity as? ComponentActivity ?: return
        if (controller?.activity !== activity) {
            disposeController()
            controller = PredictiveBackController(activity).also {
                activity.onBackPressedDispatcher.addCallback(activity, it)
            }
        }
        controller?.setNavigationEnabled(enabled)
    }

    private fun disposeController() {
        controller?.cancelPreview()
        controller?.remove()
        controller = null
    }
}
