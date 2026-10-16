package my.siood.kilometr.tracking

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * Delikatne szturchnięcie przed przystankiem, na którym trzeba wysiąść.
 *
 * To nie alarm i nie powiadomienie: dwa krótkie, lekkie drgnięcia mają tylko
 * przypomnieć użytkownikowi wpatrzonemu w telefon, że zbliża się jego
 * przystanek (albo przesiadka). Stąd niska amplituda i brak dźwięku.
 */
internal object TripVibrator {

  fun alight(context: Context) {
    val vibrator = vibratorOrNull(context) ?: return
    if (!vibrator.hasVibrator()) return
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(
          VibrationEffect.createWaveform(
            longArrayOf(0L, PULSE_MS, GAP_MS, PULSE_MS),
            intArrayOf(0, AMPLITUDE, 0, AMPLITUDE),
            NO_REPEAT,
          ),
        )
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(PULSE_MS * 2 + GAP_MS)
      }
    } catch (_: Throwable) {
      // best-effort
    }
  }

  private fun vibratorOrNull(context: Context): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val manager =
        context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
      manager?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

  /** Długość pojedynczego drgnięcia. */
  private const val PULSE_MS = 120L

  /** Przerwa między drgnięciami, żeby sygnał było czuć przez kieszeń. */
  private const val GAP_MS = 140L

  /** Niska amplituda: to przypomnienie, nie alarm. */
  private const val AMPLITUDE = 96

  private const val NO_REPEAT = -1
}
