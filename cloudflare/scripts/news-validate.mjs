// Walidacja nazw własnych w analizie względem treści źródłowej.
// Model ma kopiować nazwy z komunikatu, a nie tworzyć własne formy typu
// "Krzków" zamiast "Krzyki" albo "Włochów" zamiast "Włochy".

const DIACRITICS = {
  ą: 'a',
  ć: 'c',
  ę: 'e',
  ł: 'l',
  ń: 'n',
  ó: 'o',
  ś: 's',
  ź: 'z',
  ż: 'z',
};

export function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (char) => DIACRITICS[char])
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(value, length = 4) {
  return normalizeName(value).slice(0, length);
}

const CAPITALIZED_RE = /\b[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)*/g;

// Pomija pierwszy wyraz zdania: w polszczyźnie to zwykle zwykłe słowo z wielkiej litery.
function proseNames(text) {
  const names = [];
  for (const sentence of String(text ?? '').split(/(?<=[.!?:])\s+/)) {
    for (const match of sentence.matchAll(CAPITALIZED_RE)) {
      if (match.index === 0) continue;
      names.push(match[0]);
    }
  }
  return names;
}

/**
 * Zwraca nazwy własne, których nie ma w treści źródłowej.
 * Prozę sprawdza dokładnie, bo model ma przepisywać formę z komunikatu.
 * Przystanki sprawdza po rdzeniu, bo w JSON mają być w mianowniku.
 */
export function findUnknownNames(analysis, sourceText) {
  if (!analysis || analysis.is_transit_alert === false) return [];
  const source = normalizeName(sourceText);
  if (!source) return [];

  const unknown = new Set();

  for (const text of [analysis.headline, analysis.glance?.problem, analysis.glance?.solution]) {
    for (const name of proseNames(text)) {
      if (!source.includes(normalizeName(name))) unknown.add(name);
    }
  }

  const checkStop = (value) => {
    const normalized = normalizeName(value);
    if (!normalized || normalized === 'both') return;
    if (!source.includes(stem(value))) unknown.add(value);
  };

  for (const stop of analysis.stops || []) checkStop(stop.name);
  for (const line of analysis.impacted_lines || []) {
    checkStop(line.direction);
    for (const stop of line.omitted_stops || []) checkStop(stop);
    for (const stop of line.temporary_stops || []) checkStop(stop);
  }

  return [...unknown];
}
