// Fizyka gumki i maszyna stanów gestu wczytywania wcześniejszych połączeń.
// Czysty moduł bez react-native, żeby dało się przetestować progi jednostkowo.

/** Efektywna wysokość panelu (px), od której puszczenie wczytuje wcześniejsze połączenia. */
export const EARLIER_PULL_ARM = 60;
/** Histereza rozbrojenia (px), zapobiega migotaniu na granicy progu. */
export const EARLIER_PULL_DISARM = 48;
/** Maksymalna wysokość rozciągnięcia panelu podczas ciągnięcia. */
export const EARLIER_PULL_MAX = 112;
/** Wysokość spoczynkowa panelu w trakcie wczytywania wcześniejszych kursów. */
export const EARLIER_PULL_LOADING = 56;
/** Delikatny maksymalny odciąg, gdy nie ma już wcześniejszych połączeń tego dnia. */
export const EARLIER_PULL_EDGE_MAX = 44;

/**
 * Hiperboliczny opór gumki: przy małym ruchu niemal 1:1, a przy głębszym
 * pociągnięciu łagodnie dąży do `maxPull` bez twardego zderzenia.
 */
export function earlierRubberBand(rawDy: number, maxPull: number = EARLIER_PULL_MAX): number {
  'worklet';
  if (rawDy <= 0 || maxPull <= 0) return 0;
  const scaled = rawDy * 0.78;
  return (scaled * maxPull) / (scaled + maxPull);
}

/**
 * Wyznacza stan uzbrojenia gestu z histerezą (arm przy `EARLIER_PULL_ARM`,
 * disarm dopiero poniżej `EARLIER_PULL_DISARM`).
 */
export function nextEarlierPullArmed(armed: boolean, pullHeight: number): boolean {
  'worklet';
  return armed ? pullHeight >= EARLIER_PULL_DISARM : pullHeight >= EARLIER_PULL_ARM;
}
