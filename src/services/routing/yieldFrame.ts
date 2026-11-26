/** Budżet jednej porcji JS podczas budowania wycinków i sieci RAPTOR (mieści się w klatce 120 Hz). */
export const UI_YIELD_BUDGET_MS = 5;

/**
 * Oddaje wątek JS do następnej klatki UI, żeby scroll i gesty nie zacinały się
 * podczas dekodowania kursów lub kompilacji sieci. W środowisku bez rAF (Node)
 * lub w tle (gdy rAF nie tyka) kończy przez krótki timer bezpieczeństwa.
 */
export function yieldToUiFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      resolve();
    };
    const fallback = setTimeout(finish, 32);
    requestAnimationFrame(finish);
  });
}
