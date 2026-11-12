import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnknownNames } from './news-validate.mjs';
import {
  decodeLatin2,
  lodzReadableTitle,
  parseBialystokList,
  parseKielceList,
  parseLublinList,
  parseRadomList,
  parseSzczecinList,
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
