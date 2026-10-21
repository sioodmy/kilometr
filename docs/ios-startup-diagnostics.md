# Diagnostyka błędu startu iOS

Sześć raportów z 20 października 2026 dotyczy wersji 1.0.0, build 97.1.0.
Każdy pokazuje `SIGABRT` po `RCTExceptionsManager.reportFatal` i `RCTFatal`.
Raporty nie zawierają komunikatu wyjątku JavaScript. Wpisy z Konsoli przekazane
21 października dotyczą preferencji i stanu procesu, bez treści błędu.
Przyczyna awarii pozostaje niepotwierdzona.

`plugins/with-ios.js` instaluje natywny handler przed uruchomieniem React Native.
W Release fatalny wyjątek JS otwiera natywny ekran z pełnym komunikatem, stosem
z nazwami plików i pozycjami oraz wersją aplikacji. Przycisk udostępniania otwiera
systemowy arkusz, z którego można skopiować raport. Kod JavaScript nie jest potrzebny
do wyświetlenia tego ekranu. Kolejne błędy nie zastępują pierwszego raportu.
Błędy natywne zachowują poprzednią obsługę; Debug korzysta z obsługi React Native.

Teksty pochodzą z `src/i18n`, przez generowane `InfoPlist.strings`. Ekran odczytuje
zapisany język aplikacji, a dla ustawienia systemowego korzysta z lokalizacji iOS.
Workflow `Build IPA` zachowuje mapę `main.jsbundle.map` i dSYM w `ios-build-logs`.
Do analizy raportu należy pobrać artefakt z tego samego numeru builda.

## Sprawdzenie

Przeszły TypeScript, ESLint, `check:ios`, `check:ios-strings`, kontrola składni Swift
oraz generowanie projektu i `scripts/check-ios-prebuild.py`. Kontrola projektu
sprawdza podpięcie źródła do Xcode, instalację handlera przed startem React Native
i komplet tłumaczeń w czterech językach.

Nie wykonano kompilacji Xcode ani testu na iPhonie. Wymagają sprawdzenia:
wyświetlenie raportu po fatalnym błędzie JS w Release, przewijanie i zaznaczanie
tekstu oraz otwieranie arkusza udostępniania na iPhonie i iPadzie.
Ta zmiana udostępnia brakujący komunikat; nie potwierdza naprawy przyczyny awarii.

## Anti-slop, przegląd kodu

1. Hard Gate: PASS w przeglądzie. Teksty PL/EN/DE/UK są w słownikach; kontrolki UIKit
   mają etykiety i rzeczywiste akcje. Tekst jest przewijany, uwzględnia safe area
   i Dynamic Type. R-35: zakres weryfikacji ogranicza brak środowiska iOS opisany wyżej.
2. Purpose Gate: PASS. Natywne kontrolki działają po awarii JS. Akcent z palety
   Kilometra wyróżnia udostępnianie; nie ma dekoracji ani własnych animacji.
3. Liveliness: PASS. Kierunek: natywny ekran raportowania dla użytkownika Kilometra,
   ENERGY 1 / RHYTHM 1 / MOTION 1. Raport jest główną treścią, akcja ma jeden akcent.
4. Craftsmanship: PASS w przeglądzie. Udostępnianie przekazuje pełny raport do
   `UIActivityViewController`, z kotwicą dla iPada; zaznaczanie korzysta z `UITextView`.
   Test urządzenia pozostaje do wykonania i nie jest oznaczony jako zaliczony.
