# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Testowanie PR na prawdziwym urządzeniu

- Zawsze testuj PR na prawdziwym urządzeniu (symulator/emulator to za mało): zbuduj apk z gałęzi PR, zainstaluj i sprawdź kluczowe ścieżki.
- Każda zmiana UI musi zostać udokumentowana screenshotami z prawdziwego urządzenia, dołączonymi do opisu PR (before/after).
- Nie oznaczaj PR jako gotowy do merge bez realnego uruchomienia na urządzeniu i bez screenshotów dla zmian UI.

## Commity na bieżąco

- Commituj zmiany na bieżąco, w małych logicznych porcjach, zamiast odkładać wszystko na koniec sesji.
- Przed commitem sprawdź `git status --short`, `git diff` oraz `git log --oneline -10`, stage'uj tylko zamierzone pliki, nigdy nie commituj sekretów.
- Pisz dobre, zwięzłe commit messages w stylu repo (krótki tytuł + ewentualnie `Co:` / `Dlaczego:` w opisie). Nie używaj wulgarnych ani pustych wiadomości.
- Nie amenduj nieudanych commitów po hookach — napraw problem i zrób nowy commit.
- Nie pushuj, nie twórz PR-ów i nie zmieniaj remote'ów, chyba że użytkownik wyraźnie o to poprosi.
