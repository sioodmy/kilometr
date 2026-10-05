import { useEffect, useState } from 'react';
import {
  BellRing,
  ChevronRight,
  Database,
  Download,
  Footprints,
  Github,
  Map as MapIcon,
  Megaphone,
  RefreshCw,
  TramFront,
} from 'lucide-react';
import { PixelPhone } from './components/Phone';
import { CompassSection } from './components/Compass';
import { AnchorSection } from './components/Anchor';
import {
  APK_FALLBACK,
  APK_FILE,
  CONFIRMED,
  GITHUB_URL,
  OBTAINIUM_URL,
  RELEASES_URL,
} from './data';

function useApkHref() {
  const [href, setHref] = useState(APK_FILE);
  useEffect(() => {
    let cancelled = false;
    fetch(APK_FILE, { method: 'HEAD' })
      .then((res) => {
        if (!cancelled && !res.ok) setHref(APK_FALLBACK);
      })
      .catch(() => {
        if (!cancelled) setHref(APK_FALLBACK);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return href;
}

function DownloadButtons({ apkHref }: { apkHref: string }) {
  return (
    <div className="cta-row">
      <a
        className="cta cta-primary"
        href={apkHref}
        download="kilometr.apk"
      >
        <Download size={19} strokeWidth={2.2} />
        <span>Pobierz APK</span>
      </a>
      <a className="cta cta-ghost" href={OBTAINIUM_URL}>
        <RefreshCw size={19} strokeWidth={2.2} />
        <span>Dodaj do Obtainium</span>
      </a>
    </div>
  );
}

export default function App() {
  const apkHref = useApkHref();
  const conn = CONFIRMED.connection;

  return (
    <div className="page">
      <header className="nav">
        <a className="brand" href="#top" aria-label="Kilometr — początek strony">
          <img src="./icon.png" alt="" className="brand-mark" />
          <span>Kilometr</span>
        </a>
        <nav className="nav-links" aria-label="Nawigacja">
          <a href="#polaczenie">Połączenie</a>
          <a href="#kompas">Kompas</a>
          <a href="#offline">Offline</a>
        </nav>
        <a
          className="nav-gh"
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Kod źródłowy na GitHubie"
        >
          <Github size={20} strokeWidth={2} />
        </a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1>
              Tym razem
              <br />
              dojedziesz.
            </h1>
            <p>
              Wrocławskie połączenia MPK liczone na telefonie. Pełny rozkład
              offline, bez reklam i bez konta.
            </p>
            <DownloadButtons apkHref={apkHref} />
            <div className="hero-meta">
              <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer">
                Wszystkie wersje
                <ChevronRight size={14} strokeWidth={2.4} />
              </a>
              <span className="hero-meta-sep">·</span>
              <span>APK prosto z GitHub Releases</span>
            </div>
          </div>
          <PixelPhone />
        </section>

        <section className="conn" id="polaczenie">
          <div className="conn-card">
            <div className="conn-top">
              <b>{conn.departIn}</b>
              <span className="conn-dur">{conn.duration}</span>
            </div>
            <p className="conn-time">
              {conn.time} · {conn.via}
            </p>
            <div className="conn-line">
              <span className="conn-badge">
                <TramFront size={15} strokeWidth={2.4} />
                {conn.line}
              </span>
              <span className="conn-head">{conn.headsign}</span>
            </div>
          </div>
          <div className="conn-copy">
            <h2>Zanim wyjdziesz z domu, już wiesz.</h2>
            <p>
              Najbliższe odjazdy z Twojego przystanku, czas dojścia pieszo
              i cała trasa z przesiadkami — policzone w sekundę, na miejscu
              w telefonie.
            </p>
          </div>
        </section>

        <CompassSection />

        <AnchorSection />

        <section className="bento" id="offline">
          <h2>Cały rozkład w kieszeni.</h2>
          <div className="bento-grid">
            <article className="tile tile-wide">
              <Database size={22} strokeWidth={2} />
              <h3>Działa offline</h3>
              <p>
                Pełny rozkład MPK z Open Data Wrocław pobierasz raz
                (ok. 40–60&nbsp;MB). Potem wyszukiwanie jeździ
                bez internetu — w tunelu, w piwnicy, w tramwaju.
              </p>
            </article>
            <article className="tile">
              <BellRing size={22} strokeWidth={2} />
              <h3>Przypięte połączenie</h3>
              <p>
                Odliczanie do odjazdu i alert „wyjdź teraz”
                w powiadomieniu. Bez otwierania aplikacji.
              </p>
            </article>
            <article className="tile">
              <Megaphone size={22} strokeWidth={2} />
              <h3>Utrudnienia MPK</h3>
              <p>
                Pilne komunikaty z Wrocławia trafiają prosto
                na ekran główny, z kropką przy dzwonku.
              </p>
            </article>
          </div>
          <div className="bento-foot">
            <span className="bento-chip">
              <MapIcon size={15} strokeWidth={2.2} />
              Mapa trasy i kompas do słupka
            </span>
            <span className="bento-chip">
              <Footprints size={15} strokeWidth={2.2} />
              Dojście piesze wliczone w plan
            </span>
          </div>
        </section>

        </main>

      <footer className="foot">
        <span>Kilometr</span>
        <span className="foot-motto">Socjalizm albo barbarzyństwo</span>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          <Github size={15} strokeWidth={2} />
          Kod źródłowy
        </a>
      </footer>
    </div>
  );
}
