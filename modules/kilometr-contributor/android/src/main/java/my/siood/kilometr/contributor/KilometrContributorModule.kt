package my.siood.kilometr.contributor

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Most między JS a natywnym ContributorService.
 *
 * Osobny moduł od `KilometrTracking` celowo: `plugins/with-contributor.js`
 * wyłącza z autolinkingu właśnie ten projekt w buildach prod i play-, więc
 * te funkcje fizycznie nie istnieją w AAB/APK dla użytkowników. JS-side
 * `src/services/contributor/native.ts` obsługuje nieobecny moduł
 * (`requireOptionalNativeModule` → null) i schodzi na drogę dla delikatnej
 * niedostępności.
 */
class KilometrContributorModule : Module() {

  private val appContextOrNull: Context?
    get() = appContext.reactContext?.applicationContext

  override fun definition() = ModuleDefinition {
    Name("KilometrContributor")

    /** Startuje ContributorService z metadanymi sesji (deviceId, kurs, teksty). */
    AsyncFunction("startContributor") { json: String ->
      val context = appContextOrNull ?: return@AsyncFunction false
      ContributorService.start(context, json)
    }

    /** Zatrzymuje ContributorService i zdejmie powiadomienie. */
    AsyncFunction("stopContributor") {
      val context = appContextOrNull ?: return@AsyncFunction false
      ContributorService.stop(context)
    }

    /** Czy FGS telemetrii obecnie biega. */
    Function("isContributorRunning") { ContributorService.isRunning }
  }
}
