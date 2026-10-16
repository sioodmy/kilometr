package my.siood.kilometr.widgets

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS zapisuje snapshot i woła `reload`, żeby widgety nie czekały na systemowe odświeżenie co 30 min. */
class KilometrWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KilometrWidgets")

    AsyncFunction("reload") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction false
      KilometrWidgets.updateAll(context)
      true
    }
  }
}
