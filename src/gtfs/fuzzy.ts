import { normalizePolish } from './geo';
// Fuzzy search - wykonywany natywnie w Rust (JNI na Androidzie / inline WASM w Node/Hermes).
import {
  BinaryReader,
  BinaryWriter,
  CMD_FUZZY,
  invokeRustSync,
} from '../../modules/kilometr-raptor';

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

/** Warianty tokenu razem z synonimami (np. "plac" -> ["plac", "pl"]). */
export function expandTokenSynonyms(token: string): string[] {
  const syns = SYNONYMS.get(token);
  return syns ? [token, ...syns] : [token];
}

export interface FuzzyResult {
  matches: boolean;
  score: number;
}

/** Ocenia dopasowanie `query` do `target` w Rust/JS. Zwraca score 0..100. */
export function fuzzyMatch(query: string, target: string): FuzzyResult {
  if (!query || !target) return { matches: false, score: 0 };
  const w = new BinaryWriter(16 + (query.length + target.length) * 3);
  w.u8Val(0).str(query).str(target);
  const res = invokeRustSync(CMD_FUZZY, w.finish());
  if (res && res.byteLength >= 5) {
    const r = new BinaryReader(res);
    const matches = r.u8Val() !== 0;
    const score = r.i32();
    if (matches) return { matches, score };
  }
  const q = normalizePolish(query).toLowerCase().trim();
  const t = normalizePolish(target).toLowerCase().trim();
  if (!q || !t) return { matches: false, score: 0 };
  if (t === q) return { matches: true, score: 100 };
  if (t.startsWith(q)) return { matches: true, score: 90 };
  if (t.includes(q)) return { matches: true, score: 75 };
  const qNoSpace = q.replace(/[\s\-./()]/g, '');
  const tNoSpace = t.replace(/[\s\-./()]/g, '');
  if (qNoSpace && tNoSpace) {
    if (tNoSpace === qNoSpace) return { matches: true, score: 98 };
    if (tNoSpace.startsWith(qNoSpace)) return { matches: true, score: 90 };
    if (qNoSpace.length >= 4 && tNoSpace.includes(qNoSpace)) return { matches: true, score: 75 };
  }
  return { matches: false, score: 0 };
}

/** Wsadowe dopasowanie `query` do listy `targets` w jednym wywołaniu Rust/JS. */
export function fuzzyMatchBatch(query: string, targets: readonly string[]): FuzzyResult[] {
  if (!query || targets.length === 0) {
    return targets.map(() => ({ matches: false, score: 0 }));
  }
  const w = new BinaryWriter(32 + targets.length * 48);
  w.u8Val(2).str(query).u32(targets.length);
  for (let i = 0; i < targets.length; i++) {
    w.str(targets[i]);
  }
  const res = invokeRustSync(CMD_FUZZY, w.finish());
  if (res && res.byteLength >= 4) {
    const r = new BinaryReader(res);
    const count = r.u32();
    const out: FuzzyResult[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const matches = r.u8Val() !== 0;
      const score = r.i32();
      if (matches) {
        out[i] = { matches, score };
      } else {
        out[i] = fuzzyMatch(query, targets[i]);
      }
    }
    return out;
  }
  return targets.map((t) => fuzzyMatch(query, t));
}
