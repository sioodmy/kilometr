const FARE_BOUNDARY = /^granica\s+([A-ZĄĆĘŁŃÓŚŹŻ]+)\s*-\s*([A-ZĄĆĘŁŃÓŚŹŻ]+)(?:\s*\(([^)]+)\))?$/iu;

export function parseFareBoundary(name: string) {
  const match = FARE_BOUNDARY.exec(name.trim());
  return match ? { areas: [match[1], match[2]].join(' / '), point: match[3] ?? '' } : null;
}

export function isFareBoundary(name: string): boolean {
  return FARE_BOUNDARY.test(name.trim());
}
