// Czysta logika eksmisji cache geometrii.
//
// Wydzielone z routeGeometry.ts, żeby dało się to przetestować na hoście:
// routeGeometry ciągnie react-native (przez LineBadge), a ten plik nie ma
// żadnych zależności uruchomieniowych.

/**
 * Które klucze wypadają, gdy cache przekroczył limit.
 *
 * Bierzemy najstarsze NIEprzypięte w kolejności wstawiania (Map trzyma
 * kolejność). Przypięte nie wypadają nigdy: to trasy, do których użytkownik
 * wraca, więc limit 60 wpisów nie może ich wyrzucić na rzecz jednorazowych.
 * Gdy przypiętych jest więcej niż limit, limit ustępuje i cache rośnie.
 */
export function selectEvictions(keys: string[], pins: ReadonlySet<string>, max: number): string[] {
  const overflow = keys.length - max;
  if (overflow <= 0) return [];
  const out: string[] = [];
  for (const k of keys) {
    if (out.length >= overflow) break;
    if (!pins.has(k)) out.push(k);
  }
  return out;
}
