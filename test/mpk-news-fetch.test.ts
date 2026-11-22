import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCityNews, getCachedNews } from '../src/services/mpkNews';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

const SAMPLE_DISRUPTIONS = {
  schema_version: 2,
  city: 'wroclaw',
  alerts: [
    {
      id: 'ai-alert-1',
      source_title: 'Kolizja na Dembowskiego',
      link: 'https://www.wroclaw.pl/komunikacja/kolizja-test',
      published_at: 'Fri, 20 Nov 2026 17:59:51 +0100',
      is_transit_alert: true,
      headline: 'Kolizja na Dembowskiego: autobusy w korku',
      disruption_type: 'accident',
      is_emergency: true,
      is_resolved: false,
      severity: 'minor',
      glance: {
        problem: 'Autobusy stoją w korku.',
        solution: 'Kursy po stałych trasach.',
        timeframe: 'Od 16:30',
      },
      valid_from: '2026-11-20T16:30:00+01:00',
      valid_to: null,
      all_lines: ['145'],
      impacted_lines: [],
      stops: [],
    },
  ],
};

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>Komunikat MPK o zmianie trasy tramwaju 2</title>
    <link>https://www.wroclaw.pl/komunikacja/test-fallback</link>
    <description>Utrudnienia MPK dla linii 2.</description>
    <pubDate>Fri, 20 Nov 2026 18:00:00 +0100</pubDate>
  </item>
</channel></rss>`;

test('fetchCityNews: scraper miejski nie nadpisuje cache po wygranej alertów AI z R2', async () => {
  const originalFetch = globalThis.fetch;
  let cityFeedAborted = false;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/disruptions.json')) {
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(jsonResponse(SAMPLE_DISRUPTIONS)), 20);
      });
    }
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => {
        cityFeedAborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (init?.signal?.aborted) {
        onAbort();
        return;
      }
      init?.signal?.addEventListener('abort', onAbort, { once: true });
      setTimeout(() => {
        init?.signal?.removeEventListener('abort', onAbort);
        resolve(textResponse(SAMPLE_RSS));
      }, 80);
    });
  }) as typeof fetch;

  try {
    const news = await fetchCityNews();
    assert.equal(news.length, 1);
    assert.equal(news[0].id, 'ai-alert-1');
    assert.ok(news[0].disruption, 'wynik powinien mieć analizę AI');
    assert.equal(cityFeedAborted, true, 'równoległy scraper powinien zostać przerwany');

    // Poczekaj dłużej niż timer scrapera i sprawdź, czy cache nie został nadpisany fallbackiem.
    await new Promise((resolve) => setTimeout(resolve, 120));
    const cached = getCachedNews();
    assert.ok(cached && cached.length === 1);
    assert.equal(cached[0].id, 'ai-alert-1');
    assert.ok(cached[0].disruption, 'cache nie może zostać nadpisany surowym fallbackiem');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchCityNews: mając bogate alerty AI w cache, nie degraduje po 1.5s przy wolniejszym R2', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/disruptions.json')) {
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(jsonResponse(SAMPLE_DISRUPTIONS)), 120);
      });
    }
    return Promise.resolve(textResponse(SAMPLE_RSS));
  }) as typeof fetch;

  try {
    // Cache jest już ciepły po poprzednim teście i zawiera alert AI.
    const news = await fetchCityNews();
    assert.equal(news.length, 1);
    assert.equal(news[0].id, 'ai-alert-1');
    assert.ok(news[0].disruption);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchCityNews: gdy R2 nie ma alertów, zwraca fallback ze scrapera miasta', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/disruptions.json')) {
      return Promise.resolve(jsonResponse({ schema_version: 2, city: 'wroclaw', alerts: [] }));
    }
    if (url.includes('wroclaw.pl/komunikacja/rss')) {
      return Promise.resolve(textResponse(SAMPLE_RSS));
    }
    return Promise.resolve(textResponse('<html></html>'));
  }) as typeof fetch;

  try {
    const news = await fetchCityNews();
    assert.ok(news.length >= 1);
    assert.equal(news[0].disruption, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
