// Wspólna pomoc dla fetchy: twardy limit czasu, który DZIAŁA także wtedy,
// gdy wywołujący przekazuje własny AbortSignal.
//
// Problem, który to rozwiązuje: `fetch(url, { signal: callerSignal ?? ctrl.signal })`
// przy własnym sygnale wołającego w ogóle nie podpina wewnętrznego kontrolera
// do żądania, więc `setTimeout(() => ctrl.abort(), 5000)` nigdy nie przerywa
// zawieszonego połączenia. Ekran zostaje w stanie „pobieranie…” na zawsze.
//
// `AbortSignal.any` nie wchodzi w grę — Hermes go nie ma.

export type TimeoutScope = {
  signal: AbortSignal;
  /** Wywołaj w `finally` — czyści licznik i rozłącza nasłuch na cudzym sygnale. */
  dispose: () => void;
};

/**
 * Zwraca sygnalu, który przekracza `timeoutMs` ALBO zostaje przerwiony przez
 * `outer`. Wywołujący musi zawsze użyć `dispose()` w `finally`, inaczej
 * zostaje wiszący `setTimeout` i listener na cudzym sygnale.
 */
export function withTimeout(timeoutMs: number, outer?: AbortSignal | null): TimeoutScope {
  const ctrl = new AbortController();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onOuterAbort);
  };

  const abort = () => ctrl.abort();
  const onOuterAbort = () => abort();

  const timer = setTimeout(abort, timeoutMs);
  // Sygnał przychodzący już przerwany (albo przerwany w trakcie zakładania
  // setTimeout) musi zadziałać natychmiast, inaczej czekamy pełny timeout.
  if (outer?.aborted) abort();
  else outer?.addEventListener('abort', onOuterAbort);

  return { signal: ctrl.signal, dispose: finish };
}
