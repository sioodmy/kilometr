// Tymczasowe przekazanie wybranego pojazdu między ekranem mapy na żywo
// a ekranem głównym lub listą połączeń bez serializacji w parametrach URL.

import type { BoardedTripOrigin } from '../types/models';

export interface PendingBoardedSelection {
  origin: BoardedTripOrigin;
  target: 'home' | 'routes';
  openDestination?: boolean;
}

let pendingSelection: PendingBoardedSelection | null = null;

/** Zapamiętuje wybrany pojazd jako punkt startowy dla docelowego ekranu. */
export function setPendingBoardedOrigin(selection: PendingBoardedSelection): void {
  pendingSelection = selection;
}

/** Zwraca i czyści oczekujący wybór pojazdu przypisany do wskazanego ekranu. */
export function consumePendingBoardedOrigin(
  target: 'home' | 'routes',
): PendingBoardedSelection | null {
  if (!pendingSelection || pendingSelection.target !== target) return null;
  const next = pendingSelection;
  pendingSelection = null;
  return next;
}
