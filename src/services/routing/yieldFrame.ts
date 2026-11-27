/** Budżet jednej porcji JS podczas budowania wycinków i sieci RAPTOR (mieści się w klatce 120 Hz). */
export const UI_YIELD_BUDGET_MS = 5;

/** Mniejszy budżet podczas aktywnego scrollowania listy lub szczegółów. */
const SCROLL_YIELD_BUDGET_MS = 2;

/** Przerwa między porcjami pracy w tle podczas aktywnego scrolla (daje czyste klatki). */
const SCROLL_YIELD_PAUSE_MS = 24;

/** Bezpiecznik wygaszający stan scrollowania, gdy natywny event końca nie nadejdzie. */
const SCROLL_SAFETY_TIMEOUT_MS = 1200;

let activeScrollCount = 0;
let scrollSafetyTimer: ReturnType<typeof setTimeout> | null = null;
const scrollIdleListeners = new Set<() => void>();

function notifyScrollIdle(): void {
  if (scrollIdleListeners.size === 0) return;
  const listeners = Array.from(scrollIdleListeners);
  scrollIdleListeners.clear();
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Ignorujemy błędy pojedynczego listenera.
    }
  }
}

function clearScrollSafety(): void {
  if (scrollSafetyTimer !== null) {
    clearTimeout(scrollSafetyTimer);
    scrollSafetyTimer = null;
  }
}

function armScrollSafety(): void {
  clearScrollSafety();
  scrollSafetyTimer = setTimeout(() => {
    scrollSafetyTimer = null;
    if (activeScrollCount > 0) {
      activeScrollCount = 0;
      notifyScrollIdle();
    }
  }, SCROLL_SAFETY_TIMEOUT_MS);
}

/** Oznacza start aktywnego gestu lub rozpędu scrollowania. */
export function beginUiScroll(): void {
  activeScrollCount += 1;
  armScrollSafety();
}

/** Oznacza zakończenie gestu lub rozpędu scrollowania. */
export function endUiScroll(): void {
  if (activeScrollCount <= 0) return;
  activeScrollCount -= 1;
  if (activeScrollCount === 0) {
    clearScrollSafety();
    notifyScrollIdle();
  } else {
    armScrollSafety();
  }
}

/** Zwraca aktualny budżet porcji JS (mniejszy w trakcie scrollowania). */
export function getUiYieldBudgetMs(): number {
  return activeScrollCount > 0 ? SCROLL_YIELD_BUDGET_MS : UI_YIELD_BUDGET_MS;
}

/**
 * Czeka na zakończenie bieżącego scrolla (maksymalnie `maxWaitMs`), żeby ciężkie
 * aktualizacje Reacta nie wchodziły w środek gestu użytkownika.
 */
export function waitForUiScrollIdle(maxWaitMs = 450): Promise<void> {
  if (activeScrollCount <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      scrollIdleListeners.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, maxWaitMs);
    scrollIdleListeners.add(finish);
  });
}

/**
 * Oddaje wątek JS po domknięciu bieżącej klatki renderu, żeby style/layout/paint
 * i gesty wykonały się przed kolejną porcją dekodowania lub kompilacji sieci.
 * Podczas aktywnego scrolla robi krótką przerwę, zostawiając pełne klatki dla scrolla.
 */
export function yieldToUiFrame(): Promise<void> {
  if (activeScrollCount > 0) {
    return new Promise((resolve) => setTimeout(resolve, SCROLL_YIELD_PAUSE_MS));
  }
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
