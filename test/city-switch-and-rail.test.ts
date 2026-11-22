import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getActiveCityIdSync,
  isManualCitySelectedInSession,
  setActiveCityId,
} from '../src/services/cityStore';
import {
  getDataStatus,
  importGtfsFromNetwork,
  importInProgress,
} from '../src/services/dataManager';
import { fetchCityNews, getCachedNews } from '../src/services/mpkNews';
import { ensureNationalTimetable } from '../src/services/nationalTimetable';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('przełączenie miasta w trakcie pobierania anuluje stary transfer i uwalnia kolejkę dla nowego miasta', async () => {
  const originalFetch = globalThis.fetch;
  let wroclawAborted = false;
  let krakowManifestRequested = false;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/wroclaw/manifest.json')) {
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          wroclawAborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (init?.signal?.aborted) {
          onAbort();
          return;
        }
        init?.signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    if (url.includes('/krakow/manifest.json')) {
      krakowManifestRequested = true;
      return Promise.resolve(new Response('Not found', { status: 404 }));
    }
    return Promise.resolve(new Response('Not found', { status: 404 }));
  }) as typeof fetch;

  try {
    await setActiveCityId('wroclaw', { source: 'auto' });
    assert.equal(getActiveCityIdSync(), 'wroclaw');

    const wroclawImport = importGtfsFromNetwork('wroclaw');
    assert.equal(importInProgress, true);

    // Przełączenie w trakcie pobierania Wrocławia musi natychmiast przerwać stary transfer.
    await setActiveCityId('krakow', { source: 'manual' });
    assert.equal(getActiveCityIdSync(), 'krakow');
    assert.equal(isManualCitySelectedInSession(), true);
    assert.equal(wroclawAborted, true, 'pobieranie poprzedniego miasta powinno zostać przerwane');
    assert.equal(importInProgress, false, 'flaga importu musi być zwolniona po przełączeniu');
    assert.equal(getDataStatus().state, 'empty');

    await wroclawImport;

    // Nowe miasto może od razu uruchomić własny import (nie zwraca po cichu 'upToDate').
    await assert.rejects(() => importGtfsFromNetwork('krakow'));
    assert.equal(krakowManifestRequested, true, 'nowe miasto powinno pobrać własny manifest');
  } finally {
    globalThis.fetch = originalFetch;
    await setActiveCityId('wroclaw', { source: 'auto' });
  }
});

test('szybkie przełączenie A -> B -> A kończy na A', async () => {
  await setActiveCityId('wroclaw', { source: 'auto' });
  const p1 = setActiveCityId('krakow', { source: 'manual' });
  const p2 = setActiveCityId('wroclaw', { source: 'manual' });
  await Promise.all([p1, p2]);
  assert.equal(getActiveCityIdSync(), 'wroclaw');
});

test('zmiana miasta czyści pamięć aktualności i spóźniony fetch starego miasta jej nie nadpisuje', async () => {
  const originalFetch = globalThis.fetch;
  let releaseWroclaw: () => void = () => {};

  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/wroclaw/disruptions.json')) {
      return new Promise<Response>((resolve) => {
        releaseWroclaw = () =>
          resolve(
            jsonResponse({
              schema_version: 2,
              city: 'wroclaw',
              alerts: [
                {
                  id: 'wro-1',
                  source_title: 'Awaria MPK Wrocław',
                  link: 'https://www.wroclaw.pl/komunikacja/test',
                  published_at: '2026-11-22T10:00:00+01:00',
                  is_transit_alert: true,
                  headline: 'Awaria MPK Wrocław',
                  disruption_type: 'accident',
                  is_emergency: true,
                  is_resolved: false,
                  severity: 'minor',
                  all_lines: ['1'],
                  impacted_lines: [],
                  stops: [],
                },
              ],
            }),
          );
      });
    }
    return Promise.resolve(new Response('', { status: 404 }));
  }) as typeof fetch;

  try {
    await setActiveCityId('wroclaw', { source: 'auto' });
    const pendingFetch = fetchCityNews();
    await new Promise((r) => setImmediate(r));
    await setActiveCityId('krakow', { source: 'manual' });
    assert.equal(getCachedNews(), null, 'cache aktualności musi wyczyścić się przy zmianie miasta');

    releaseWroclaw();
    await pendingFetch;
    assert.equal(
      getCachedNews(),
      null,
      'spóźniony fetch z Wrocławia nie może trafić do cache Krakowa',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await setActiveCityId('wroclaw', { source: 'auto' });
  }
});

test('baza kolejowa pobiera się domyślnie (ensureNationalTimetable nie kończy na idle bez bazy)', async () => {
  const originalFetch = globalThis.fetch;
  let requestedPolskaManifest = false;

  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/polska/manifest.json')) {
      requestedPolskaManifest = true;
    }
    return Promise.resolve(new Response('offline', { status: 503 }));
  }) as typeof fetch;

  try {
    const res = await ensureNationalTimetable();
    assert.equal(
      requestedPolskaManifest,
      true,
      'ensureNationalTimetable powinno odpytać manifest bazy kolejowej domyślnie',
    );
    assert.notEqual(res.phase, 'idle');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
