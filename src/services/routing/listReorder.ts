// Wykrywanie realnej zamiany kolejności kart na liście (np. przez opóźnienie live)
// oraz liczenie przesunięć FLIP na podstawie zmierzonych wysokości komórek.

export interface ReorderShift {
  /** Przesunięcie startowe w px (oldY - newY): >0 ruch w górę, <0 ruch w dół. */
  deltaY: number;
  direction: 'up' | 'down';
}

/**
 * Zwraca mapę przesunięć FLIP wyłącznie wtedy, gdy istniejące karty zmieniły
 * swoją względną kolejność. Prepend wcześniejszych, append późniejszych oraz
 * filtrowanie zachowują porządek wspólnych kart, więc zwracają pustą mapę.
 */
export function computeReorderShifts(
  prevIds: readonly string[],
  nextIds: readonly string[],
  heights: ReadonlyMap<string, number>,
  fallbackHeight: number,
  gap: number,
): Map<string, ReorderShift> {
  const shifts = new Map<string, ReorderShift>();
  if (prevIds.length < 2 || nextIds.length < 2) return shifts;

  const nextSet = new Set(nextIds);
  const prevCommon: string[] = [];
  for (const id of prevIds) {
    if (nextSet.has(id)) prevCommon.push(id);
  }
  if (prevCommon.length < 2) return shifts;

  const prevSet = new Set(prevCommon);
  const nextCommon: string[] = [];
  for (const id of nextIds) {
    if (prevSet.has(id)) nextCommon.push(id);
  }
  if (nextCommon.length !== prevCommon.length) return shifts;

  let reordered = false;
  for (let i = 0; i < prevCommon.length; i++) {
    if (prevCommon[i] !== nextCommon[i]) {
      reordered = true;
      break;
    }
  }
  if (!reordered) return shifts;

  const oldY = new Map<string, number>();
  let cursor = 0;
  for (const id of prevCommon) {
    oldY.set(id, cursor);
    cursor += (heights.get(id) ?? fallbackHeight) + gap;
  }

  cursor = 0;
  for (const id of nextCommon) {
    const prevPos = oldY.get(id) ?? cursor;
    const deltaY = prevPos - cursor;
    if (Math.abs(deltaY) >= 2) {
      shifts.set(id, {
        deltaY,
        direction: deltaY > 0 ? 'up' : 'down',
      });
    }
    cursor += (heights.get(id) ?? fallbackHeight) + gap;
  }

  return shifts;
}
