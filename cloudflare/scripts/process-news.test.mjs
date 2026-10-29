import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnknownNames } from './news-validate.mjs';

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
  const source = 'Objazd przez Włochy.';
  const analysis = {
    is_transit_alert: true,
    headline: 'Objazd przez Włochów',
    glance: { problem: 'Tramwaje jadą przez Włochów.', solution: null },
  };
  assert.deepEqual(findUnknownNames(analysis, source), ['Włochów']);
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
