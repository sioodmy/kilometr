/**
 * Wspólne pobieranie z Overpassa. Kilka instancji bywa przeciążonych naraz,
 * a pojedyncze zapytanie potrafi wisieć dłużej niż cały build. Dlatego
 * kolejne lustra startują po `hedgeMs` (albo od razu, gdy poprzednie padnie),
 * a wygrywa pierwsza poprawna odpowiedź. Przegrane zapytania są anulowane.
 */

/**
 * Kolejność ma znaczenie: openstreetmap.fr odpowiada w kilka sekund, a
 * overpass-api.de bywa przeciążony (502 na starcie). kumi/private.coffee
 * często wiszą, a mail.ru ma dziury w importach, więc jest ostatni.
 */
export const DEFAULT_OVERPASS_MIRRORS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export function overpassMirrors(override) {
  return [...new Set([override, ...DEFAULT_OVERPASS_MIRRORS].filter(Boolean))];
}

export function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const budgetError = () => {
  const error = new Error('Overpass: przekroczony budżet czasu');
  error.code = 'OVERPASS_BUDGET';
  return error;
};

/** Pierwsza spełniona obietnica; kolejne próby startują po hedze albo po błędzie. */
function raceHedged(factories, hedgeMs) {
  return new Promise((resolve, reject) => {
    const timers = new Set();
    let next = 0;
    let pending = 0;
    let settled = false;
    let lastError = new Error('Overpass: brak luster');

    const clearTimers = () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };

    const launch = () => {
      if (settled || next >= factories.length) return;
      const index = next++;
      pending++;
      const hedge = setTimeout(() => {
        timers.delete(hedge);
        launch();
      }, hedgeMs);
      timers.add(hedge);

      Promise.resolve()
        .then(factories[index])
        .then(
          (value) => {
            if (settled) return;
            settled = true;
            clearTimers();
            resolve(value);
          },
          (error) => {
            clearTimeout(hedge);
            timers.delete(hedge);
            pending--;
            lastError = error;
            if (settled) return;
            if (next >= factories.length && pending === 0) {
              settled = true;
              clearTimers();
              reject(lastError);
            } else {
              launch();
            }
          },
        );
    };

    launch();
  });
}

/**
 * Zwraca `elements` z pierwszej instancji, która odpowie poprawnie.
 * Rzuca ostatnim błędem, gdy padną wszystkie; `deadline` (ms epoch) anuluje
 * wszystkie próby i zwraca błąd z kodem OVERPASS_BUDGET.
 */
export async function fetchOverpassElements({
  query,
  fetcher = fetch,
  mirrors,
  userAgent,
  timeoutMs = 75_000,
  hedgeMs = 20_000,
  deadline = Infinity,
}) {
  const budgetLeft = deadline - Date.now();
  if (budgetLeft <= 0) throw budgetError();
  const controller = new AbortController();
  const budgetTimer = Number.isFinite(budgetLeft)
    ? setTimeout(() => controller.abort(budgetError()), budgetLeft)
    : null;

  const factories = mirrors.map((url) => async () => {
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
    });
    if (!response.ok) throw new Error(`Overpass HTTP ${response.status} @ ${url}`);
    const json = await response.json();
    if (json.remark || !Array.isArray(json.elements)) {
      throw new Error(`Niepełna odpowiedź Overpass @ ${url}: ${json.remark || 'brak elements'}`);
    }
    return json.elements;
  });

  try {
    return await raceHedged(factories, hedgeMs);
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    if (budgetTimer) clearTimeout(budgetTimer);
    controller.abort();
  }
}
