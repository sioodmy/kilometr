// Lekki kanał powiadomień o zastosowaniu kopii zapasowej (bez wciągania backup.ts przy starcie).
const appliedListeners = new Set<() => void>();

/** Subskrypcja na zapis wczytanej kopii. Zwraca funkcję odsubskrybującą. */
export function subscribeBackupApplied(fn: () => void): () => void {
  appliedListeners.add(fn);
  return () => {
    appliedListeners.delete(fn);
  };
}

export function notifyBackupApplied(): void {
  for (const l of appliedListeners) l();
}
