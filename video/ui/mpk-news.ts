// Mock komunikatów miejskich: pusta lista, bez błędu sieci na zrzucie.
export type MpkNewsItem = { id: string; title: string; description?: string; disruption?: unknown };

export function getCachedNews(): MpkNewsItem[] | null {
  return [];
}

export async function loadNewsCache(): Promise<MpkNewsItem[] | null> {
  return [];
}

export async function fetchCityNews(): Promise<MpkNewsItem[]> {
  return [];
}

export async function fetchDisruptionsFromWorker(): Promise<MpkNewsItem[]> {
  return [];
}

export function rememberNewsItemForDetail() {}

export async function findNewsItemForDetail() {
  return null;
}

export function formatNewsDate() {
  return '';
}

export function normalizeArticleUrl() {
  return null;
}
