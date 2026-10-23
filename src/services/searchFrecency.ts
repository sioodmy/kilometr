import { fuzzyMatchBatch } from '../gtfs/fuzzy';
import { normalizePolish } from '../gtfs/geo';
import type { Suggestion } from '../types/models';

const HALF_LIFE_MS = 14 * 86400000;

/** Każdy wybór dodaje punkt; po 14 dniach jego wpływ maleje o połowę. */
export function frecency(item: Suggestion, now = Date.now()): number {
  const usage = item.searchUsage;
  if (!usage || !Number.isFinite(usage.score) || !Number.isFinite(usage.lastUsedAt)) return 0;
  return Math.max(0, usage.score) * 2 ** (-Math.max(0, now - usage.lastUsedAt) / HALF_LIFE_MS);
}

export function suggestionIdentity(item: Suggestion): string {
  return `${normalizePolish(item.title)}:${item.lat.toFixed(4)}:${item.lon.toFixed(4)}`;
}

/** Jedna paczka do silnika fuzzy obejmuje nazwy, aliasy i adresy. */
export function matchSuggestions(query: string, items: Suggestion[]): number[] {
  const targets = items.flatMap((item) => [item.title, ...(item.aliases ?? []), item.address]);
  const matches = fuzzyMatchBatch(query, targets);
  let offset = 0;
  return items.map((item) => {
    let score = 0;
    const names = 1 + (item.aliases?.length ?? 0);
    for (let i = 0; i < names; i++) {
      const match = matches[offset++];
      if (match?.matches) score = Math.max(score, match.score);
    }
    const address = matches[offset++];
    if (address?.matches) score = Math.max(score, address.score - 20);
    return score;
  });
}

/** Frecency rozstrzyga podobne trafienia; dokładna nazwa i trafiony przystanek zachowują priorytet. */
export function rankWithFrecency(
  items: Suggestion[],
  history: Suggestion[],
  query: string,
  now = Date.now(),
): Suggestion[] {
  const byId = new Map(history.map((item) => [item.id, item]));
  const byPlace = new Map(history.map((item) => [suggestionIdentity(item), item]));
  const matches = matchSuggestions(query, items);
  const normQuery = normalizePolish(query);
  const wantsAddress = /\d/.test(query);
  return items
    .map((item, index) => {
      const remembered = byId.get(item.id) ?? byPlace.get(suggestionIdentity(item)) ?? item;
      const match = matches[index];
      const exact = normalizePolish(item.title) === normQuery;
      const tier = exact
        ? 3
        : item.kind === 'stop' && match >= 80
          ? 2
          : wantsAddress && item.kind === 'address'
            ? 1
            : 0;
      const usage = frecency(remembered, now);
      const bonus = 24 * usage / (usage + 4);
      const score =
        match +
        bonus -
        Math.min(40, (item.distanceM ?? 0) / 250) +
        Math.min(12, (item.weight ?? 0) / 100);
      return {
        item: remembered.searchUsage ? { ...item, searchUsage: remembered.searchUsage } : item,
        tier, score, index,
      };
    })
    .sort((a, b) => b.tier - a.tier || b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}
