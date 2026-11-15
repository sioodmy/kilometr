#!/usr/bin/env node
// Bramka przed buildem wydania: weryfikuje, czy produkcyjny manifest rozkładu
// zawiera realne dane Kolei Dolnośląskich (a nie atrapę / MPK-only).
// Gdy serwer nie odpowiada, wypisuje ostrzeżenie i przepuszcza build; gdy
// odpowiada, ale brak KD — przerywa z kodem 1.

const baseUrl = (process.env.TIMETABLE_URL || 'https://data.kilometr.app').replace(/\/+$/, '');
const manifestUrl = `${baseUrl}/wroclaw/manifest.json`;

async function main() {
  let response;
  try {
    response = await fetch(manifestUrl, { signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `::warning::Nie mogę pobrać manifestu rozkładu (${manifestUrl}: ${reason}). Pomijam weryfikację KD.`,
    );
    return;
  }

  if (!response.ok) {
    console.warn(
      `::warning::Manifest rozkładu zwrócił HTTP ${response.status} (${manifestUrl}). Pomijam weryfikację KD.`,
    );
    return;
  }

  const manifest = await response.json();
  const kd = manifest?.sources?.kd ?? {};
  const stations = Number(kd.stations || 0);
  const trips = Number(kd.trips || 0);

  if (kd.skippedReason || stations <= 0 || trips <= 0) {
    console.error(
      `::error::Manifest bez realnego KD (skippedReason=${kd.skippedReason || 'null'}, stations=${stations}, trips=${trips}). Przerywam build wydania.`,
    );
    process.exit(1);
  }

  console.log(
    `KD OK: stations=${stations}, routes=${kd.routes || 0}, trips=${trips}, interchanges=${kd.interchanges || 0}`,
  );
}

main();
