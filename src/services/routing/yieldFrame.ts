/** Budżet jednej porcji JS podczas budowania wycinków i sieci RAPTOR (mieści się w klatce 120 Hz). */
export const UI_YIELD_BUDGET_MS = 5;

/**
 * Oddaje wątek JS po domknięciu bieżącej klatki renderu, żeby style/layout/paint
 * i gesty wykonały się przed kolejną porcją dekodowania lub kompilacji sieci.
 */
export function yieldToUiFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    let done = false;
    let afterPaintTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      if (afterPaintTimer !== null) clearTimeout(afterPaintTimer);
      resolve();
    };
    const fallback = setTimeout(finish, 48);
    requestAnimationFrame(() => {
      if (done) return;
      if (typeof document !== 'undefined') {
        // W przeglądarce callback rAF biegnie przed paintem; setTimeout(0) puszcza kolejną porcję po klatce.
        afterPaintTimer = setTimeout(finish, 0);
      } else {
        finish();
      }
    });
  });
}
