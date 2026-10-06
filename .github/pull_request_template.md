## 📋 Opis zmian

<!--
Zwięzły opis wprowadzonych zmian w stylu przyjętym w repozytorium:
- Co zostało zmienione?
- Dlaczego ta zmiana była potrzebna?
-->

### Co:
- 

### Dlaczego:
- 

---

## 🏷️ Typ zmiany

<!-- Zaznacz właściwe opcje wpisując 'x' w nawiasy [x] -->

- [ ] `feat`: Nowa funkcja
- [ ] `fix`: Naprawa błędu
- [ ] `ui`: Zmiana interfejsu użytkownika (UI / animacje / motywy)
- [ ] `i18n`: Nowe lub zaktualizowane tłumaczenia
- [ ] `perf`: Optymalizacja wydajności (czas reakcji, pamięć, bateria)
- [ ] `refactor`: Refaktoryzacja kodu bez zmiany zachowania
- [ ] `ci`: Zmiany w GitHub Actions, buildzie lub skryptach narzędziowych
- [ ] `docs`: Aktualizacja dokumentacji

---

## 🔗 Powiązane zgłoszenia

<!-- Np. Closes #123, Fixes #45 lub Refs #67 -->
Closes #

---

## 📱 Weryfikacja na prawdziwym urządzeniu

> [!IMPORTANT]
> Zgodnie z zasadami projektu: emulator/symulator to za mało! Zbuduj APK z gałęzi tego PR, zainstaluj na fizycznym telefonie i zweryfikuj kluczowe ścieżki.

- **Model urządzenia**: <!-- np. Google Pixel 8 / Samsung Galaxy S23 -->
- **Wersja systemu**: <!-- np. Android 15 / OneUI 6 (Android 14) -->
- **Wersja kompilacji / Architektura**: `arm64-v8a`
- **Przetestowane scenariusze**:
  - [x] Instalacja i uruchomienie aplikacji
  - [ ] 

---

## 📸 Zrzuty ekranu (Before / After)

<!--
OBOWIĄZKOWE dla każdej zmiany UI:
Dołącz zrzuty ekranu wykonane na prawdziwym urządzeniu.
-->

| Przed zmianą (Before) | Po zmianie (After) |
| :---: | :---: |
| <!-- Przeciągnij zrzut ekranu tutaj --> | <!-- Przeciągnij zrzut ekranu tutaj --> |

<details>
<summary>🎥 Nagranie wideo (opcjonalnie)</summary>

<!-- Przeciągnij nagranie ekranu MP4 / GIF tutaj -->

</details>

---

## 🌐 Tłumaczenia (i18n)

<!-- Zaznacz, jeśli w PR dodano lub zmodyfikowano teksty widoczne dla użytkownika -->

- [ ] Zero hardcodu tekstu – wszystkie stringi pochodzą z `src/i18n` (`useStrings()` / `tr()`).
- [ ] Dodano tłumaczenia do wszystkich 4 języków (`pl.ts` jako wzorzec oraz `en.ts`, `de.ts`, `uk.ts`).
- [ ] Liczby mnogie i odmiany obsłużone jako funkcje w słowniku.
- [ ] Nie dotyczy (brak zmian w tekstach UI).

---

## ✅ Checklist jakościowa

- [ ] Aplikacja została przetestowana na **prawdziwym urządzeniu** (zbudowano APK).
- [ ] Zmiany w UI posiadają zrzuty ekranu z fizycznego urządzenia (Before / After).
- [ ] `npm run typecheck` (`tsc --noEmit`) przechodzi bez żadnych błędów.
- [ ] Skrypty weryfikacyjne przechodzą lokalnie:
  - `npm run check:backup`
  - `npm run check:notifications`
  - `npm run check:smart-rank`
- [ ] Commity są małe, logiczne i mają zwięzłe wiadomości w stylu projektu.
- [ ] Brak commitowanych sekretów, plików `.env` czy logów tymczasowych.
