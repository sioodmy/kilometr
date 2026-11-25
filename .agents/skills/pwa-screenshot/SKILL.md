---
name: pwa-screenshot
description: "Use when taking screenshots of any screen or UI element of the real React Native Web / PWA app and showing them in the conversation."
---

# PWA Screenshot (Zrzuty ekranu prawdziwej aplikacji Web PWA)

Ten skill pozwala uruchomić prawdziwą aplikację Kilometr w wersji Web PWA (`react-native-web` + `expo-router` + OPFS SQLite), wejść na dowolny ekran lub wyciąć konkretny element UI i pokazać zrzut bezpośrednio w czacie T3 Code.

## Kiedy używać

- User prosi o pokazanie, jak wygląda zmiana w UI ("pokaż mi jak to wygląda", "zrób screena").
- Chcesz zweryfikować wizualnie przebudowany komponent lub ekran na prawdziwych danych GTFS zamiast zgadywać z kodu.

## Kiedy NIE używać

- Zwykłe zmiany w logice lub tekstach, w których user nie prosił o zrzut ekranu.

---

## 1. Uruchomienie lub użycie Web PWA

Masz dwie ścieżki:

1. **Lokalny dev server (gdy testujesz niezdeployowane zmiany w bieżącym worktree)**:
   - Jeśli w worktree brakuje `node_modules` lub `src/map/maplibreAssets.generated.ts`, podlinkuj `node_modules` albo wygeneruj assety:
     `nix develop .#ci -c 'node scripts/bundle-maplibre.mjs'`
   - Uruchom serwer Expo Web w tle (`IsDaemon: true`) na wolnym porcie (np. `8098`):
     `nix develop .#ci -c 'CI=1 npx expo start --web --port 8098'`
   - Otwórz kartę T3 preview przez `preview_open` z `target: { kind: "environment-port", port: 8098 }`.
2. **Produkcyjna PWA (`https://web.kilometr.app`)**:
   - Tylko gdy chcesz pokazać aktualny stan produkcji bez lokalnych edycji: `preview_open` z `url: "https://web.kilometr.app"`.

Ustaw mobilny rozmiar ekranu przez `preview_resize`:
- `{ mode: "freeform", width: 390, height: 844 }` (standardowy telefon).

---

## 2. Pominięcie onboardingu i ustawienie miasta (IndexedDB KV)

Aplikacja na webie trzyma stan w IndexedDB (`kilometr-web-kv`, store `kv`). Żeby od razu wejść na ekran główny lub trasę bez przeklikiwania onboardingu, wstrzyknij klucze przez `preview_evaluate` i odśwież stronę:

```javascript
await new Promise((resolve, reject) => {
  const req = indexedDB.open('kilometr-web-kv', 1);
  req.onupgradeneeded = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
  };
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('kv', 'readwrite');
    const store = tx.objectStore('kv');
    store.put('1', 'kilometr.onboardingSeen.v1');
    store.put('wroclaw', 'kilometr.activeCity.v1');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  };
  req.onerror = () => reject(req.error);
});
location.reload();
```

---

## 3. Nawigacja na dowolny ekran (`expo-router`)

Możesz nawigować bezpośrednio po URL (parametry `expo-router`):

| Ekran | Ścieżka / URL |
|---|---|
| Ekran główny | `/` |
| Lista połączeń | `/routes?fromTitle=PL.%20GRUNWALDZKI&fromLat=51.1115&fromLon=17.0603&toTitle=DWORZEC%20G%C5%81%C3%93WNY&toLat=51.0988&toLon=17.0365` |
| Szczegóły połączenia | Kliknij pierwszą kartę na `/routes` przez `preview_act` (po załadowaniu wyników) |
| Rozkład linii | `/line?line=4&city=wroclaw` |
| Mapa pojazdów na żywo | `/live-map` |
| Komunikaty i utrudnienia | `/news` |
| Ustawienia | `/settings` |
| Onboarding | `/onboarding` |

Przy wejściu na `/routes` zaczekaj (`preview_wait_for`), aż baza SQLite miasta pobierze się do OPFS i zniknie `RouteLoadingView`.

---

## 4. Zrzut całego ekranu lub pojedynczego elementu UI

1. **Cały ekran telefonu**:
   - Wywołaj `preview_snapshot` z `{ save: true, includeImage: true }`.
   - Narzędzie zwróci absolutną ścieżkę `screenshotPath`.
2. **Konkretny komponent / karta UI (crop do elementu)**:
   - Jeśli chcesz pokazać sam komponent (np. jedną kartę połączenia), pobierz jego `getBoundingClientRect()` w `preview_evaluate` albo wyizoluj go w kadrze i zrób `preview_snapshot({ save: true })`.
3. **Pokazanie w konwersacji**:
   - Wklej zrzut w odpowiedzi Markdown jako:
     `![Opis ekranu](/absolutna/ścieżka/do/pliku.png)`
4. **Sprzątanie**:
   - Po wykonaniu zrzutu zamknij kartę przez `t3_preview_close` i zabij lokalny serwer Expo (`manage_task` -> `kill`), jeśli sam go uruchomiłeś.
