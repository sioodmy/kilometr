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

// Nazwa może być odmieniona, ale jej rdzeń musi być w treści.
function nameMatchesSource(name, source) {
  const words = normalizeName(name).split(' ').filter((word) => word.length > 2);
  if (words.length === 0) return true;
  return words.every((word) => source.includes(word.slice(0, 4)));
}

/**
 * Zwraca nazwy własne, których nie ma w treści źródłowej ani w dozwolonym
 * zestawie przystanków GTFS linii z komunikatu.
 * Prozę sprawdza po rdzeniu, żeby dopuścić poprawną odmianę, ale wyłapać
 * nazwy spoza treści. Przystanki sprawdza tak samo, bo w JSON mają być
 * w mianowniku.
 */
export function findUnknownNames(analysis, sourceText, allowedGtfsStops = null) {
  if (!analysis || analysis.is_transit_alert === false) return [];
  const source = normalizeName(sourceText);
  if (!source) return [];

  const unknown = new Set();
  const hasAllowedStop = (value) => {
    if (!allowedGtfsStops || allowedGtfsStops.size === 0) return false;
    const norm = normalizeName(value);
    return Boolean(norm && allowedGtfsStops.has(norm));
  };

  for (const text of [
    analysis.headline,
    analysis.glance?.problem,
    analysis.glance?.solution,
    analysis.ticket_honoring?.summary,
  ]) {
    for (const name of proseNames(text)) {
      if (!nameMatchesSource(name, source) && !hasAllowedStop(name)) unknown.add(name);
    }
  }

  const checkStop = (value) => {
    const normalized = normalizeName(value);
    if (!normalized || normalized === 'both') return;
    if (hasAllowedStop(value)) return;
    if (!source.includes(stem(value))) unknown.add(value);
  };

  if (analysis.corridor) {
    checkStop(analysis.corridor.from_stop);
    checkStop(analysis.corridor.to_stop);
  }

  for (const stop of analysis.stops || []) {
    checkStop(stop.name);
    checkStop(stop.replaced_by);
  }
  const checkLineChange = (lc) => {
    checkStop(lc.direction);
    checkStop(lc.from_stop);
    checkStop(lc.to_stop);
    for (const v of lc.via || []) checkStop(v);
    for (const stop of lc.omitted_stops || []) checkStop(stop);
    for (const stop of lc.temporary_stops || []) checkStop(stop);
    for (const stop of lc.transfer_stops || []) checkStop(stop);
  };
  for (const line of analysis.line_changes || []) checkLineChange(line);
  // Kompatybilność ze starym polem: analyzed przed 2026-11 używały impacted_lines.
  for (const line of analysis.impacted_lines || []) checkLineChange(line);
  for (const t of analysis.temporary_lines || []) {
    for (const v of t.via || []) checkStop(v);
  }

  return [...unknown];
}

const SLOP_PHRASES_RE =
  /\b(przepraszamy za (utrudnienia|niedogodności)|za utrudnienia przepraszamy|prosimy o wyrozumiałość)\b\.?/gi;

function cleanProseField(text) {
  if (typeof text !== 'string') return text;
  const cleaned = text
    .replace(/\u2014/g, ': ')
    .replace(/\s+--\s+/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(SLOP_PHRASES_RE, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,:;!?])/g, '$1')
    .trim();
  return cleaned;
}

/**
 * Czyści teksty wygenerowane przez LLM z pauz em dash (U+2014), spacjonowanych
 * łączników i urzędowych formułek grzecznościowych przed zapisem do R2.
 */
export function sanitizeAnalysisText(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  if (typeof analysis.headline === 'string') {
    analysis.headline = cleanProseField(analysis.headline);
  }
  if (analysis.glance && typeof analysis.glance === 'object') {
    if (typeof analysis.glance.problem === 'string') {
      analysis.glance.problem = cleanProseField(analysis.glance.problem);
    }
    if (typeof analysis.glance.solution === 'string') {
      analysis.glance.solution = cleanProseField(analysis.glance.solution) || null;
    }
    if (typeof analysis.glance.timeframe === 'string') {
      analysis.glance.timeframe = cleanProseField(analysis.glance.timeframe);
    }
  }
  if (analysis.corridor && typeof analysis.corridor.label === 'string') {
    analysis.corridor.label = cleanProseField(analysis.corridor.label);
  }
  if (analysis.ticket_honoring && typeof analysis.ticket_honoring.summary === 'string') {
    analysis.ticket_honoring.summary = cleanProseField(analysis.ticket_honoring.summary) || null;
  }
  for (const lc of analysis.line_changes || []) {
    if (typeof lc.details === 'string') lc.details = cleanProseField(lc.details);
  }
  for (const tl of analysis.temporary_lines || []) {
    if (typeof tl.details === 'string') tl.details = cleanProseField(tl.details);
  }
  for (const st of analysis.stops || []) {
    if (typeof st.details === 'string') st.details = cleanProseField(st.details);
  }
  return analysis;
}
