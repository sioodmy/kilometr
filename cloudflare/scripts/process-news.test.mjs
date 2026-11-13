import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnknownNames, sanitizeAnalysisText } from './news-validate.mjs';
import {
  buildGtfsPromptContext,
  decodeLatin2,
  enrichAlertWithGtfs,
  isComplexDisruptionText,
  lodzReadableTitle,
  parseBialystokList,
  parseKielceList,
  parseLublinList,
  parseRadomList,
  parseSzczecinList,
  resolveLlmPlan,
} from './process-news.mjs';

const JUNK_TITLE_RE =
  /\b(przetarg|zamówieni[ae]|rekrutacj|oferta pracy|zatrudnimy|aukcj[ae]|składnik[oó]w majątkowych|rzeczy znalezionych|konkurs plastyczn|życzenia|wesołych świąt|facebook|instagram|tiktok|polub nas)\b/i;

function isObviousJunk(title, content) {
  if (JUNK_TITLE_RE.test(title)) return true;
  if (/facebook\.com|instagram\.com/i.test(content) && content.length < 250 && !/\blini[iaę]\b/i.test(content)) {
    return true;
  }
  return false;
}

function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:p|div|li|tr|h[1-6]|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&Oacute;/gi, 'Ó')
    .replace(/&bdquo;/gi, '„')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ndash;|&mdash;/gi, '–')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

test('odrzuca posty o social mediach bez treści transportowej', () => {
  assert.equal(
    isObviousJunk('Odwiedź nasz profil na Facebooku!', 'Tutaj link do naszego fanpage: facebook.com/mpk'),
    true
  );
  assert.equal(
    isObviousJunk('Polub nas na Instagramie', 'Zapraszamy do śledzenia zdjęć z zajezdni.'),
    true
  );
});

test('odrzuca przetargi i ogłoszenia rekrutacyjne', () => {
  assert.equal(
    isObviousJunk('Przetarg nieograniczony na dostawę części zamiennych', 'Szczegóły w BIP.'),
    true
  );
  assert.equal(
    isObviousJunk('Rekrutacja: Zatrudnimy kierowców kat. D', 'Oferujemy stabilne warunki pracy.'),
    true
  );
});

test('przepuszcza realne komunikaty pasażerskie', () => {
  assert.equal(
    isObviousJunk('Remont torowiska na pl. Bema – zmiany dla linii 8, 9, 11 i 17', 'Od poniedziałku tramwaje pojadą objazdem...'),
    false
  );
  assert.equal(
    isObviousJunk('Czasowa zmiana lokalizacji przystanku Dworzec Główny', 'Słupek zostaje przesunięty o 50 metrów.'),
    false
  );
});

test('wyłapuje zmyśloną nazwę dzielnicy', () => {
  const source = 'Utrudnienia w rejonie Krzykach. Objazd przez Włochy.';
  const analysis = {
    is_transit_alert: true,
    headline: 'Utrudnienia w Krzkowie',
    glance: { problem: 'Kolizja w Krzkowie.', solution: null },
  };
  assert.deepEqual(findUnknownNames(analysis, source), ['Krzkowie']);
});

test('wyłapuje Włochów jako nazwę dzielnicy', () => {
  const source = 'Objazd przez Wolę.';
  const analysis = {
    is_transit_alert: true,
    headline: 'Objazd przez Włochów',
    glance: { problem: 'Tramwaje jadą przez Włochów.', solution: null },
  };
  assert.deepEqual(findUnknownNames(analysis, source), ['Włochów']);
});

test('przepuszcza odmienioną nazwę z treści', () => {
  const source = 'Bieruń. Przystanek Bieruń Królowej Jadwigi.';
  const analysis = {
    is_transit_alert: true,
    headline: 'Przystanek w Bieruniu',
    glance: { problem: 'Przystanek w Bieruniu jest przesunięty.', solution: null },
  };
  assert.deepEqual(findUnknownNames(analysis, source), []);
});

test('przepuszcza nazwy z treści i mianownik przystanku', () => {
  const source = 'Utrudnienia w rejonie Krzykach. Objazd przez Włochy.';
  const analysis = {
    is_transit_alert: true,
    headline: 'Objazd przez Włochy',
    glance: { problem: 'Utrudnienia w rejonie Krzykach.', solution: null },
    stops: [{ name: 'Krzyki' }],
  };
  assert.deepEqual(findUnknownNames(analysis, source), []);
});

test('nie zgłasza zwykłego słowa na początku zdania', () => {
  const source = 'Zamknięta ulica.';
  const analysis = {
    is_transit_alert: true,
    headline: 'Kolizja na ulicy',
    glance: { problem: 'Zamknięta ulica.', solution: null },
  };
  assert.deepEqual(findUnknownNames(analysis, source), []);
});

test('pomija komunikaty odrzucone przez model', () => {
  assert.deepEqual(findUnknownNames({ is_transit_alert: false, headline: 'Krzków' }, 'brak'), []);
});

test('cleanHtml usuwa znaczniki i dekoduje polskie encje html', () => {
  const html = '<p>Linia 945 powr&oacute;ci na tras\u0119.</p><ul><li>Krzyk&oacute;w</li></ul>';
  const cleaned = cleanHtml(html);
  assert.match(cleaned, /Linia 945 powróci na trasę/);
  assert.match(cleaned, /Krzyków/);
  assert.ok(!cleaned.includes('<p>'));
  assert.ok(!cleaned.includes('<ul>'));
});

test('dekoduje łódzki RSS z ISO-8859-2', () => {
  const bytes = Uint8Array.from([0xa3, 0xf3, 0x64, 0xbc]);
  assert.equal(decodeLatin2(bytes.buffer), 'Łódź');
});

test('Łódź: generyczny tytuł zastępuje początkiem treści', () => {
  const item = {
    title: 'Planowane zmiany w rozkładach jazdy',
    content: 'W nocy z 12 na 13 listopada linia 6 pojedzie objazdem.',
  };
  assert.match(lodzReadableTitle(item).title, /^W nocy z 12 na 13 listopada/);
});

test('parsuje listę ZTM Kielce', () => {
  const html = `
    <div class="com-content-category-blog__item">
      <dl><dd>meta</dd></dl>
      <h2><a href="/aktualnosci/123-remont.html">Remont torowiska</a></h2>
      <time datetime="2026-11-10T09:00:00+01:00"></time>
      <p>Linia 1 pojedzie objazdem.</p>
    </div>`;
  const items = parseKielceList(html, 6);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Remont torowiska');
  assert.equal(items[0].link, 'https://ztm.kielce.pl/aktualnosci/123-remont.html');
  assert.match(items[0].content, /Linia 1 pojedzie objazdem/);
});

test('parsuje listę ZDiTM Szczecin', () => {
  const html = `
    <div class="card shadow img-hover">
      <a href="https://www.zditm.szczecin.pl/pl/pasazer/informacje/123-remont" class="stretched-link">Remont ulicy</a>
      <time datetime="2026-11-10T09:00:00+01:00"></time>
      <p class="card-text mt-3">Utrudnienia dla linii 1 i 2.</p>
    </div>`;
  const items = parseSzczecinList(html, 6);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Remont ulicy');
  assert.match(items[0].content, /linii 1 i 2/);
});

test('parsuje listę MZDiK Radom', () => {
  const html = `
    <article class="section__article">
      <h3 class="article__header"><a href="komunikaty/123-remont">Remont od dnia 6.10.2026</a></h3>
      <div class="article__info">Linia 1 pojedzie objazdem.</div>
    </article>`;
  const items = parseRadomList(html, 6);
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://mzdik.pl/komunikaty/123-remont');
  assert.match(items[0].pubDate, /^2026-10-06/);
});

test('parsuje listę BKM Białystok', () => {
  const html = `
    <li class="news__item">
      <div class="news__date">14.10.2026 09:53</div>
      <h2><a class="news__title" href="/pl/informacje/wiadomosci/komunikaty/123" title="Zmiana trasy linii 10">Zmiana trasy linii 10</a></h2>
    </li>`;
  const items = parseBialystokList(html, 6);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Zmiana trasy linii 10');
  assert.equal(items[0].link, 'https://komunikacja.bialystok.pl/pl/informacje/wiadomosci/komunikaty/123');
  assert.match(items[0].pubDate, /^2026-10-14/);
});

test('parsuje listę ZDiTM Lublin i dziedziczy datę grupy', () => {
  const html = `
    <article class="news">
      <div class="data nowosc"><h4>2026-10-15 11:48</h4></div>
      <article class="tiny">
        <h3 class="inline">Remont na al. Solidarności</h3>
        <p>Linia 1 pojedzie objazdem.</p>
        <a href="/pl/aktualnosci/123-remont.html">Zobacz więcej</a>
      </article>
    </article>
    <article class="news">
      <article class="tiny">
        <h3 class="inline">Druga zmiana</h3>
        <p>Linia 2 pojedzie objazdem.</p>
        <a href="/pl/aktualnosci/124-zmiana.html">Zobacz więcej</a>
      </article>
    </article>`;
  const items = parseLublinList(html, 6);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Remont na al. Solidarności');
  assert.ok(items[0].pubDate);
  assert.equal(items[1].pubDate, items[0].pubDate);
});

test('resolveLlmPlan buduje hybrydę deepseek-flash + gemini-3.8-flash gdy oba klucze są dostępne', () => {
  const plan = resolveLlmPlan('auto', null, {
    DEEPSEEK_API_KEY: 'sk-ds',
    GEMINI_API_KEY: 'gm-key',
  });
  assert.equal(plan.mode, 'auto-hybrid');
  assert.equal(plan.primary.provider, 'deepseek');
  assert.equal(plan.primary.model, 'deepseek-flash');
  assert.equal(plan.secondary.provider, 'gemini');
  assert.equal(plan.secondary.model, 'gemini-3.8-flash');
});

test('resolveLlmPlan mapuje aliasy deepseekv4.1flash i gemini 3.8flash', () => {
  const ds = resolveLlmPlan('deepseekv4.1flash', null, { DEEPSEEK_API_KEY: 'sk-ds' });
  assert.equal(ds.primary.model, 'deepseek-flash');
  const gm = resolveLlmPlan('gemini 3.8flash', null, { GEMINI_API_KEY: 'gm-key' });
  assert.equal(gm.primary.model, 'gemini-3.8-flash');
});

test('enrichAlertWithGtfs wylicza omijane przystanki między from_stop i to_stop oraz współrzędne', () => {
  const gtfsIndex = {
    byLine: new Map([
      [
        '3',
        {
          line: '3',
          routeId: 'r3',
          type: 0,
          headsign: 'Księże Małe',
          stops: [
            'Galeria Dominikańska',
            'Urząd Wojewódzki',
            'Plac Zgody',
            'Krakowska',
            'Księże Małe',
          ],
        },
      ],
    ]),
    stopsByNorm: new Map([
      ['galeria dominikanska', { id: 's1', name: 'Galeria Dominikańska', lat: 51.1082, lon: 17.0394 }],
      ['urzad wojewodzki', { id: 's2', name: 'Urząd Wojewódzki', lat: 51.1088, lon: 17.0481 }],
      ['plac zgody', { id: 's3', name: 'Plac Zgody', lat: 51.1059, lon: 17.0512 }],
      ['krakowska', { id: 's4', name: 'Krakowska', lat: 51.0962, lon: 17.0623 }],
      ['ksieze male', { id: 's5', name: 'Księże Małe', lat: 51.0841, lon: 17.0875 }],
    ]),
  };

  const ctx = buildGtfsPromptContext(
    { title: 'Objazd linii 3', content: 'Linia 3 jedzie objazdem z pominięciem ul. Krakowskiej.' },
    gtfsIndex,
  );
  assert.deepEqual(ctx.matchedLines, ['3']);
  assert.match(ctx.promptBlock, /Linia 3: Galeria Dominikańska -> Urząd Wojewódzki/);

  const rawAnalysis = {
    is_transit_alert: true,
    headline: 'Krakowska: objazd linii 3',
    glance: { problem: 'Zamknięta ul. Krakowska.', solution: null, timeframe: 'Dziś' },
    corridor: {
      label: 'ul. Krakowska',
      from_stop: 'galeria dominikanska',
      to_stop: 'Księże Małe',
    },
    line_changes: [
      {
        line: '3',
        direction: 'Księże Małe',
        change: 'detour',
        from_stop: 'Galeria Dominikańska',
        to_stop: 'Księże Małe',
        via: ['Traugutta'],
        omitted_stops: [],
        temporary_stops: [],
        transfer_stops: ['Galeria Dominikańska'],
        replacement_line: '703',
        hours: [],
        details: 'Objazd przez Traugutta.',
      },
    ],
    stops: [],
  };

  // Przystanki z GTFS (Urząd Wojewódzki, Plac Zgody) są dozwolone przez allowedStops nawet gdy nie padły w tekście
  assert.deepEqual(findUnknownNames(rawAnalysis, 'Krakowska Księże Małe Galeria Dominikańska Traugutta', ctx.allowedStops), []);

  const enriched = enrichAlertWithGtfs(rawAnalysis, gtfsIndex);
  assert.deepEqual(enriched.line_changes[0].omitted_stops, [
    'Urząd Wojewódzki',
    'Plac Zgody',
    'Krakowska',
  ]);
  assert.equal(enriched.corridor.from_stop, 'Galeria Dominikańska');
  assert.equal(enriched.stop_coords['Plac Zgody'].stop_id, 's3');
});

test('sanitizeAnalysisText usuwa em dash i urzędowe przeprosiny', () => {
  const dirty = {
    is_transit_alert: true,
    headline: 'Krakowska \u2014 objazd linii 3',
    glance: {
      problem: 'Awaria torowiska - wstrzymany ruch. Za utrudnienia przepraszamy.',
      solution: 'Autobus 703 -- co 10 minut.',
      timeframe: 'Od 12:00',
    },
    line_changes: [{ details: 'Skrócenie trasy \u2014 pętla tymczasowa.' }],
  };
  const clean = sanitizeAnalysisText(dirty);
  assert.ok(!JSON.stringify(clean).includes('\u2014'));
  assert.ok(!clean.glance.problem.toLowerCase().includes('przepraszamy'));
  assert.equal(clean.headline, 'Krakowska: objazd linii 3');
});

test('isComplexDisruptionText wykrywa wieloetapowe i wieloliniowe komunikaty', () => {
  assert.equal(isComplexDisruptionText('Krótka awaria', 'Linia 5 stoi.', 1), false);
  assert.equal(isComplexDisruptionText('Remont węzła', 'Etap I od soboty, Etap II od wtorku.', 2), true);
  assert.equal(isComplexDisruptionText('Wielkie zmiany', 'Dużo linii.', 6), true);
});

