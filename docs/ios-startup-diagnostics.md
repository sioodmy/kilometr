# Diagnostyka błędu startu iOS

Sześć raportów z 20 października 2026 dotyczy wersji 1.0.0, build 97.1.0.
Każdy pokazuje `SIGABRT` po `RCTExceptionsManager.reportFatal` i `RCTFatal`.
Raporty nie zawierają komunikatu wyjątku JavaScript. Wpisy z Konsoli przekazane
21 października dotyczą preferencji i stanu procesu, bez treści błędu.

Raport z urządzenia z builda 7.1.0 wskazał przyczynę: `initLocale()` wykonywało
`import('react-native')`. Metro tworzy przy tym obiekt z wszystkimi eksportami
pakietu i odczytuje także getter `PushNotificationIOS`. Ten próbuje utworzyć
`NativeEventEmitter` z nieobecnym modułem natywnym, co kończy start wyjątkiem
`new NativeEventEmitter() requires a non-null argument`.

Import jest teraz statyczny i pobiera wyłącznie `AppState`. Nie wymaga dołączania
starego modułu powiadomień. `scripts/check-ios-locale.ts`, uruchamiany w `check:ios`,
sprawdza start bez `PushNotificationIOS`, pojedynczą subskrypcję `AppState`,
zmianę języka systemowego po powrocie do aplikacji i zachowanie języka wybranego ręcznie.

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

Build diagnostyczny z commita `e80a6ec` przeszedł kompilację Xcode w runie
`39573153151`. Raport przesłany przez użytkownika potwierdza działanie natywnego
przechwytywania błędu na iPhonie. Poprawka importu wymaga sprawdzenia w kolejnym IPA.
Przewijanie i arkusz udostępniania na iPadzie pozostają niezweryfikowane.

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
