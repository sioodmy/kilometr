/**
 * Prognoza opóźnienia na przystankach przed pojazdem: opóźnienie z GPS maleje
 * po drodze, bo pojazd nadrabia. Wsiadanie zakłada szybkie nadrabianie (lepiej
 * poczekać niż uciec), wysiadanie wolne (przesiadka na styk nie przejdzie).
 * Przewaga przed czasem znika szybko, bo pojazd czeka na punktach kontrolnych.
 */

/** Po tylu sekundach jazdy przed pojazdem prognoza odjazdu spada o połowę. */
const BOARD_LATE_HALF_LIFE_SEC = 15 * 60;
/** Po tylu sekundach jazdy przed pojazdem prognoza przyjazdu spada o połowę. */
const ARRIVE_LATE_HALF_LIFE_SEC = 30 * 60;
/** Przewaga pojazdu przed czasem znika przy wysiadaniu w takim tempie. */
const ARRIVE_EARLY_HALF_LIFE_SEC = 5 * 60;
/** Ile przewagi przed czasem uznajemy przy wsiadaniu (dalej to szum GPS). */
const BOARD_EARLY_CAP_SEC = 120;

export type DelayUse = 'board' | 'arrive';

/**
 * Prognozowane opóźnienie (sekundy) na przystanku, do którego pojazd ma
 * jeszcze `aheadSec` sekund jazdy według rozkładu. `aheadSec <= 0` znaczy,
 * że pojazd już tam był: zwracamy pomiar bez zmian.
 */
export function predictDelaySec(measuredSec: number, aheadSec: number, use: DelayUse): number {
  if (measuredSec === 0) return 0;
  const ahead = Math.max(0, aheadSec);
  if (measuredSec > 0) {
    const hl = use === 'board' ? BOARD_LATE_HALF_LIFE_SEC : ARRIVE_LATE_HALF_LIFE_SEC;
    return Math.round(measuredSec * Math.pow(0.5, ahead / hl));
  }
  if (use === 'board') return Math.max(measuredSec, -BOARD_EARLY_CAP_SEC);
  return Math.round(measuredSec * Math.pow(0.5, ahead / ARRIVE_EARLY_HALF_LIFE_SEC));
}
