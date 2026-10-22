# Kontrola zmian iOS

## 1. Hard Gate: FAIL

Nie wykonano testu na urządzeniu ani kompilacji Swift. Dostęp do urządzeń T3 jest
wyłączony, a środowisko nie ma Xcode. R-35 pozostaje niespełnione. Nie potwierdzam
usunięcia artefaktu na fizycznym iPhonie ani wyglądu, VoiceOver i kliknięć widgetów.

Przeszły: TypeScript, lint zmienionych plików, testy powiadomień iOS, snapshotu,
cyklu śledzenia, celów nawigacji i zgodności tłumaczeń. Prebuild i kontrola projektu
potwierdzają App Group, zasoby rozszerzenia i ciemny wygląd aplikacji.
Kontrast akcentu: 6,43:1 na białym tle, 10,87:1 na tle `#111414`.
Teksty pochodzą z `src/i18n`; dane podróży ze snapshotu aplikacji.

## 2. Purpose-Gate: PASS w przeglądzie kodu

SF Symbols oznaczają środki transportu i zapisane miejsca. Kolor linii zachowuje
identyfikację kursu. Miętowy akcent wyróżnia czas i postęp. Systemowy krój,
semantyczne tło i marginesy służą dopasowaniu do iOS. Brak dekoracyjnych animacji.
Widgety mają osobną obsługę renderowania barwionego i pełnokolorowego.

Podstawy: [tło WidgetKit](https://developer.apple.com/documentation/widgetkit/displaying-the-right-widget-background),
[Dynamic Island](https://developer.apple.com/documentation/widgetkit/dynamicisland).

## 3. Liveliness: PASS w przeglądzie kodu

Kierunek z briefu: natywny iOS. ENERGY 2 / RHYTHM 2 / MOTION 1.
Licznik jest punktem skupienia podróży. Kierunki są listą, miejsca skrótami,
wyszukiwanie pojedynczą czynnością. Powtarzają się symbole transportu i kolory
linii. Odliczanie oraz postęp animuje system.

## 4. Craftsmanship: FAIL do weryfikacji natywnej

Przegląd kodu potwierdza linki: kierunek otwiera planer, podróż przekazuje `open`,
miejsce otwiera własny cel, wyszukiwanie przekazuje `search=1`. To kontrola kodu,
nie zapis kliknięć na urządzeniu. Przyciski w widgetach mają obszary co najmniej
44 pt. Większy tekst ogranicza drugorzędne informacje i liczbę wierszy.
Timeline wygasza odjazdy i podróż; uszkodzony snapshot daje stan pusty.

Do sprawdzenia na iPhonie: galeria czterech widgetów, wszystkie rozmiary,
jasny, ciemny i barwiony wygląd, długie nazwy, Dynamic Type, VoiceOver,
każdy link, zwinięta i rozwinięta Dynamic Island oraz przejścia i gest powrotu.
Test modelu Swift dodano do workflow IPA; lokalnie nie został uruchomiony.

Kolor kontenera nawigacji pochodzi z motywu zgodnego z aplikacją, zgodnie z
[API motywów React Navigation](https://reactnavigation.org/docs/themes/).
