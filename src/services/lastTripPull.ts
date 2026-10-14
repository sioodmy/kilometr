// Maszyna stanów pulla "ostatnia trasa / droga powrotna" na ekranie głównym.
//
// Czysty moduł bez react-native, żeby dało się przetestować przejścia progów
// pod `tsx` (`npm run check:pull`). Progi liczbowe biorą się z komponentu
// (arm2 zależy od wysokości ekranu), tu trzymamy tylko decyzję opcji.

export type LastTripOption = 0 | 1 | 2;

/**
 * Opcja pulla dla bieżącego postępu `h` (px) i poprzedniej opcji `cur`.
 * Zasady: powyżej `arm2` zawsze reverse (2); po wejściu w reverse histereza
 * `disarm2`, żeby pociągnięcie w okolicy progu nie migotało między 1 a 2;
 * poniżej `arm1` to rozbrojenie (0).
 */
export function nextPullOption(
  cur: LastTripOption,
  h: number,
  arm1: number,
  arm2: number,
  disarm2: number,
): LastTripOption {
  if (h >= arm2) return 2;
  if (cur === 2) return h >= disarm2 ? 2 : h >= arm1 ? 1 : 0;
  return h >= arm1 ? 1 : 0;
}
