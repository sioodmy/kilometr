import { tr } from '../i18n';

/** Poprawna odmiana liczby przesiadek (słownik i18n: 1 / 2-4 / 5+). */
export function transfersLabel(n: number): string {
  return tr().connection.transfers(n);
}
