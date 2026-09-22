import { normalizePolish } from '../gtfs/geo';

/**
 * Damerau-Levenshtein distance (allows insertion, deletion, substitution, and transposition of adjacent characters).
 */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (!la) return lb;
  if (!lb) return la;

  const d = Array.from({ length: la + 1 }, () => new Array(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) d[i][0] = i;
  for (let j = 0; j <= lb; j++) d[0][j] = j;

  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[la][lb];
}

const SYNONYM_GROUPS: string[][] = [
  ['pl', 'plac'],
  ['dw', 'dworzec'],
  ['al', 'aleja', 'aleje'],
  ['os', 'osiedle'],
  ['sw', 'swiety', 'swietego', 'swietej'],
  ['gal', 'galeria'],
  ['pkp', 'dworzec', 'glowny', 'kolejowa', 'stacja'],
  ['jp2', 'jana', 'pawla'],
  ['rd', 'rondo'],
  ['ul', 'ulica'],
];

const SYNONYMS = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    const existing = SYNONYMS.get(word) || [];
    SYNONYMS.set(word, [...new Set([...existing, ...group])]);
  }
}

function expandTokens(tokens: string[]): string[][] {
  const expanded: string[][] = [];
  for (const t of tokens) {
    const syns = SYNONYMS.get(t);
    if (syns) {
      expanded.push([t, ...syns]);
    } else {
      expanded.push([t]);
    }
  }
  return expanded;
}

interface TokenMatchResult {
  match: boolean;
  dist: number;
  isPrefix: boolean;
  exact: boolean;
}

function matchTokenAgainstTargetWords(queryVariants: string[], targetWords: string[]): TokenMatchResult {
  let bestDist = 99;
  let bestIsPrefix = false;
  let bestIsExact = false;

  for (const qTok of queryVariants) {
    for (const tWord of targetWords) {
      if (tWord === qTok) {
        return { match: true, dist: 0, isPrefix: true, exact: true };
      }
      if (tWord.startsWith(qTok)) {
        bestDist = 0;
        bestIsPrefix = true;
        continue;
      }
      if (tWord.includes(qTok)) {
        if (bestDist > 0) {
          bestDist = 0;
          bestIsPrefix = false;
        }
        continue;
      }

      // Typo tolerance for words of length >= 3
      if (qTok.length >= 3) {
        const maxDist = qTok.length >= 7 ? 2 : 1;

        // Check exact length prefix of target
        const prefix0 = tWord.slice(0, qTok.length);
        const d0 = damerauLevenshtein(qTok, prefix0);
        if (d0 <= maxDist && d0 < bestDist) {
          bestDist = d0;
          bestIsPrefix = true;
        }

        // Check length + 1 prefix
        if (tWord.length > qTok.length) {
          const prefix1 = tWord.slice(0, qTok.length + 1);
          const d1 = damerauLevenshtein(qTok, prefix1);
          if (d1 <= maxDist && d1 < bestDist) {
            bestDist = d1;
            bestIsPrefix = true;
          }
        }

        // Check length - 1 prefix (if user typed an extra character)
        if (qTok.length > 3) {
          const prefix2 = tWord.slice(0, qTok.length - 1);
          const d2 = damerauLevenshtein(qTok, prefix2);
          if (d2 <= maxDist && d2 < bestDist) {
            bestDist = d2;
            bestIsPrefix = true;
          }
        }
      }
    }
  }

  if (bestDist <= 2) {
    return { match: true, dist: bestDist, isPrefix: bestIsPrefix, exact: bestIsExact };
  }
  return { match: false, dist: 99, isPrefix: false, exact: false };
}

export interface FuzzyResult {
  matches: boolean;
  score: number;
}

/**
 * Scores how well `query` matches `target`.
 * Returns score in range [0..100] where 100 is exact match, and 0 is no match.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  const normQ = normalizePolish(query);
  const normT = normalizePolish(target);
  if (!normQ || !normT) return { matches: false, score: 0 };

  // 1. Exact string matches
  if (normT === normQ) {
    return { matches: true, score: 100 };
  }
  if (normT.startsWith(normQ)) {
    // Proximity penalty for length difference
    const score = Math.max(92, 98 - (normT.length - normQ.length));
    return { matches: true, score };
  }

  const qTokens = normQ.split(/[\s,./()\\-]+/).filter(Boolean);
  const tTokens = normT.split(/[\s,./()\\-]+/).filter(Boolean);
  if (!qTokens.length || !tTokens.length) return { matches: false, score: 0 };

  // 2. Acronym match (e.g. "pg" -> "Plac Grunwaldzki", "dw gl" -> "Dworzec Główny")
  if (qTokens.length === 1 && normQ.length >= 2 && normQ.length <= 4) {
    const initials = tTokens.map((w) => w[0]).join('');
    if (initials.startsWith(normQ)) {
      return { matches: true, score: 85 };
    }
  }

  // 3. Token-set matching with synonyms and typo tolerance
  const expandedQ = expandTokens(qTokens);
  let totalDist = 0;
  let matchesCount = 0;
  let allPrefix = true;
  let allExact = true;

  for (const qVariants of expandedQ) {
    const res = matchTokenAgainstTargetWords(qVariants, tTokens);
    if (res.match) {
      matchesCount++;
      totalDist += res.dist;
      if (!res.isPrefix) allPrefix = false;
      if (!res.exact) allExact = false;
    }
  }

  // All query tokens found in target!
  if (matchesCount === qTokens.length) {
    if (totalDist === 0) {
      if (allExact && qTokens.length === tTokens.length) {
        return { matches: true, score: 98 }; // identical words, different order
      }
      return { matches: true, score: allPrefix ? 90 : 82 };
    }
    // Matches with typos
    const penalty = totalDist * 10;
    return { matches: true, score: Math.max(50, 84 - penalty) };
  }

  // If query has > 2 tokens, allow 1 missing token if remaining have 0 distance
  if (qTokens.length > 2 && matchesCount >= qTokens.length - 1 && totalDist <= 1) {
    return { matches: true, score: Math.max(40, 65 - totalDist * 10) };
  }

  // 4. Substring fallback
  if (normT.includes(normQ)) {
    return { matches: true, score: 72 };
  }

  // 5. Direct whole-string typo match (e.g. single word typo "grunwladzki" on single-word target)
  if (qTokens.length === 1 && normQ.length >= 5) {
    for (const tWord of tTokens) {
      if (tWord.length >= 4) {
        const d = damerauLevenshtein(normQ, tWord);
        const maxD = normQ.length >= 7 ? 2 : 1;
        if (d <= maxD) {
          return { matches: true, score: 74 - d * 8 };
        }
      }
    }
  }

  return { matches: false, score: 0 };
}
