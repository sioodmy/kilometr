// Nowe feedy Wrocławia dopisują numer słupka do nazwy ("GALERIA DOMINIKAŃSKA 01").
// Wyszukiwarka pokazuje wtedy jeden przystanek zamiast kilkunastu wierszy.

const TRAILING_NUMBER = /\s+(\d{1,2})$/;

interface NumberedGroup {
  names: string[];
  suffixes: Set<string>;
  platformNumber: boolean;
}

function splitNumberedName(name: string): { base: string; suffix: string } | null {
  const match = TRAILING_NUMBER.exec(name);
  if (!match) return null;
  return { base: name.slice(0, match.index).trimEnd(), suffix: match[1] };
}

/**
 * Nazwa -> nazwa bazowa dla grup słupków (01, 02...), które są jednym przystankiem.
 * Numery posesji ("Kowalska 56") nie mają wiodącego zera, więc zostają osobno.
 */
export function numberedStopBases(names: Iterable<string>): Map<string, string> {
  const groups = new Map<string, NumberedGroup>();
  for (const name of names) {
    const split = splitNumberedName(name);
    if (!split) continue;
    let group = groups.get(split.base);
    if (!group) {
      group = { names: [], suffixes: new Set(), platformNumber: false };
      groups.set(split.base, group);
    }
    group.names.push(name);
    group.suffixes.add(split.suffix);
    if (split.suffix.length === 2 && split.suffix.startsWith('0')) {
      group.platformNumber = true;
    }
  }

  const bases = new Map<string, string>();
  for (const [base, group] of groups) {
    if (!group.platformNumber || group.suffixes.size < 2) continue;
    for (const name of group.names) bases.set(name, base);
  }
  return bases;
}
