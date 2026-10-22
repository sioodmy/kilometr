# Widgety ekranu głównego

Cztery widgety na Androidzie i iOS:

| Widget | Zastosowanie |
| --- | --- |
| Twoje kierunki | Zapisane i ostatnio wyszukiwane cele, czas wyjścia, linie i punkt początkowy. Przycisk odświeżenia otwiera aplikację. |
| Moje miejsca | Skróty do tras z bieżącej lokalizacji, z nazwami i ikonami miejsc. |
| Twoja podróż | Wybrana podróż: odliczanie, godziny, postęp czasowy i przesiadki. |
| Dokąd jedziemy? | Wyszukiwanie trasy i skróty do miejsc, jeśli mieszczą się obok tekstu. |

Widget „Czas wyjść” został usunięty, również z listy providerów Androida.

Kierunek: ENERGY 2 / RHYTHM 2 / MOTION 1. Duży licznik wyróżnia czas,
tonalne powierzchnie porządkują kierunki, a ikony identyfikują miejsca i środki
transportu. Systemowy krój i zewnętrzny promień narożników dopasowują widgety
do Androida. Informacje pozostają tekstem, bez migających oznaczeń.
Podstawą są [wytyczne stylu widgetów Androida](https://developer.android.com/design/ui/mobile/guides/widgets/style).

Kolory mają osobne role tekstu i tła w jasnym i ciemnym motywie. Android 12+
używa palety tapety; starsze wersje korzystają z palety miętowej. Rozmiar
zawartości pochodzi z rzeczywistych rozmiarów launchera. Przy większej czcionce
ubywa drugorzędnych informacji i wierszy.

iOS używa SwiftUI i WidgetKit: systemowej typografii, SF Symbols, semantycznego
tła oraz marginesów systemu. Kolory dopasowują się do jasnego i ciemnego wyglądu.
Symbole oznaczają miejsca i środki transportu; kolory linii zachowują znaczenie
z aplikacji. Dynamic Island ma osobne układy zwinięty, minimalny i rozwinięty.
Odliczanie i postęp rysuje system, bez uruchamiania JS co sekundę.

`KilometrWidgetsModule` zapisuje snapshot atomowo do App Group
`group.app.kilometr.widgets`. Ten sam identyfikator musi być dostępny w podpisie
aplikacji i rozszerzenia `KilometrLiveActivity`. Bez dostępu do wspólnego kontenera
widgety pokazują stan pusty. Rozszerzenie zawiera cztery widgety i Live Activity.

Dane pochodzą ze snapshotu aplikacji. Dotknięcie kierunku otwiera planer
w aplikacji; sam widget nie pobiera nowych połączeń. Wyświetlany czas
aktualizacji dotyczy zapisanych danych. Pasek podróży pokazuje upływ czasu
między wyjściem a przyjazdem, a nie pozycję GPS.
Na iOS timeline usuwa nieaktualne odliczania i kończy podgląd podróży dwie minuty
po planowanym przyjeździe. Sam widget nie odświeża danych sieciowych.

Teksty natywne są generowane z `src/i18n`:

```sh
npm run sync:widget-strings
npm run check:widget-strings
npm run typecheck
npm run check:widget-badge
```

`WidgetRenderTest` sprawdza natywne RemoteViews: kliknięcia, wygasanie danych,
fazy podróży, rozmiary launchera, czcionkę do 200% i kontrast co najmniej
4,5:1 na Androidzie 11 i 14. Test używa natywnego renderera Robolectric.
Opcjonalny parametr Gradle `-PwidgetScreenshots=/ścieżka/do/katalogu`
zapisuje podglądy na danych przykładowych. Testy jednostkowe nie budują APK.

Przed wydaniem należy sprawdzić dodawanie i zmianę rozmiaru widgetów
w launcherze na urządzeniu. Na iOS sprawdź również galerię WidgetKit, jasny,
ciemny i barwiony wygląd, większy tekst, VoiceOver oraz otwieranie każdej trasy.
