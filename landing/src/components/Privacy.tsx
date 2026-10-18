import { ArrowLeft } from 'lucide-react';
import { GITHUB_URL } from '../data';

// ─────────────────────────────────────────────────────────────────────────────
// Podstrona polityki prywatności (widok `#polityka`): link do niej idzie
// do formularza w Google Play, więc tekst musi być prawdziwy co do zdania
// i dać się przeczytać bez kontekstu. Fakty z kodu: uprawnienia w app.json,
// adresy źródeł w src/services/gtfsConfig.ts (nominatim, zbiorkom, bus
// position), tryb contributora z lokalizacją w tle w src/services/contributor/.
// Celowo bez wątków prawniczych i bez obietnic, których nie da się sprawdzić.
// ─────────────────────────────────────────────────────────────────────────────

const SOURCES = [
  {
    what: 'Rozkłady i mapa linii',
    details: 'otwarte dane Wrocławia, część pakietów podaje data.kilometr.wroclaw.pl',
  },
  {
    what: 'Pozycje pojazdów na żywo',
    details: 'mpk.wroc.pl i api.zbiorkom.live',
  },
  {
    what: 'Adresy i trasa pieszo',
    details: 'Nominatim i Overpass z OpenStreetMap',
  },
  {
    what: 'Komunikaty i utrudnienia',
    details: 'strony wroclaw.pl i MPK',
  },
] as const;

export function Privacy() {
  return (
    <div className="pv">
      <a className="pv-back" href="#top">
        <ArrowLeft size={17} strokeWidth={2.2} />
        <span>Kilometr</span>
      </a>
      <header className="pv-hero">
        <h1>Polityka prywatności.</h1>
        <p>
          Ta polityka opisuje aplikację Kilometr na Androida i tę stronę.
          Wersja z 18 października 2026. Tekst zmienia się tylko wtedy, gdy
          zmienia się to, co faktycznie robi kod.
        </p>
      </header>

      <h2 className="pv-h">Nie zbieramy danych osobowych</h2>
      <p className="pv-p">
        Nie ma tu konta, logowania, reklam, analityki ani śledzenia, nie ma
        więc też profilu do sprzedaży. Poza pakietami rozkładów i zapytaniami
        do publicznych źródeł (o nich niżej) nic nie opuszcza aplikacji.
      </p>

      <h2 className="pv-h">Dane trzymane wyłącznie na telefonie</h2>
      <p className="pv-p">
        Zapisane miejsca, historia wyszukiwań, ustawienia i pobrane rozkłady
        leżą w pamięci aplikacji na Twoim urządzeniu. Chcąc je usunąć,
        wyczyść pamięć aplikacji w ustawieniach Androida albo po prostu
        odinstaluj Kilometr. Wtedy nic po nich nie zostaje.
      </p>

      <h2 className="pv-h">Lokalizacja</h2>
      <p className="pv-p">
        Aplikacja pyta o lokalizację, gdy szukasz połączeń z Twojej pozycji,
        najbliższych przystanków, albo śledzisz pojazd na żywo. Pozycję
        liczy aplikacja na miejscu, do żadnego serwera jej nie wysyłamy.
      </p>
      <p className="pv-p">
        Nagrywanie tras (tryb contributora) potrafi działać też w tle,
        wtedy telefon czyta lokalizację również przy zamkniętej aplikacji.
        Nagranie zostaje na urządzeniu i wychodzi tylko wtedy, gdy sam je
        wyeksportujesz i wyślesz.
      </p>

      <h2 className="pv-h">Powiadomienia</h2>
      <p className="pv-p">
        Powiadomienia o odjazdach wystawia telefon na podstawie tego, co
        sam ustawiłeś. Nie dołączamy newsletterów ani powiadomień
        marketingowych.
      </p>

      <h2 className="pv-h">Połączenia z Internetem</h2>
      <p className="pv-p">
        Rozkłady, pozycje pojazdów i komunikaty muszą najpierw przyjść z
        sieci. Aplikacja pobiera je z publicznych źródeł:
      </p>
      <ul className="pv-list">
        {SOURCES.map((s) => (
          <li key={s.what}>
            <b>{s.what}</b> <span className="pv-dim">{s.details}</span>
          </li>
        ))}
      </ul>
      <p className="pv-p">
        To zwykłe zapytania o dane: lecą w nich parametry wyszukiwania,
        czyli przystanek, linia albo fragment adresu, który wpisałeś. Nie
        dorzucamy identyfikatora urządzenia ani niczego, co pozwala wskazać
        konkretną osobę.
      </p>

      <h2 className="pv-h">Ta strona</h2>
      <p className="pv-p">
        Tu na stronie siedzi Google Analytics, więc widzimy, ile osób ją
        odwiedza. Aplikacja żyje bez analityki i nie przesyła na tę stronę
        żadnych danych.
      </p>

      <h2 className="pv-h">Kontakt</h2>
      <p className="pv-p">
        Kod jest otwarty na GitHubie, więc pytania do tej polityki i
        zgłoszenia prowadzimy publicznie: <a className="pv-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">github.com/sioodmy/kilometr</a>.
      </p>
    </div>
  );
}
