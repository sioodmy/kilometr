import { useEffect, useState } from 'react';
import { Download, Github, RefreshCw, TramFront } from 'lucide-react';
import { PixelPhone } from './components/Phone';
import { TramMark } from './components/TramMark';
import { CompassSection } from './components/Compass';
import { AnchorSection } from './components/Anchor';
import { LiveUpdateSection } from './components/LiveUpdate';
import {
  APK_FALLBACK,
  APK_FILE,
  CONFIRMED,
  GITHUB_URL,
  OBTAINIUM_URL,
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
      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            {/* Nazwa marki to nagłówek, hasło schodzi niżej: inaczej
                „Tym razem dojedziesz" zajmowałoby pierwszy ekran. */}
            <div className="hero-brand">
              <TramMark size={54} />
              <h1>Kilometr</h1>
            </div>
            <p className="hero-tagline">Tym razem dojedziesz.</p>
            <p>
              Wrocławskie połączenia MPK liczone na telefonie. Pełny rozkład
              offline, bez reklam i bez konta.
            </p>
            <DownloadButtons apkHref={apkHref} />
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
              i cała trasa z przesiadkami, policzone w sekundę, na miejscu
              w telefonie.
            </p>
          </div>
        </section>

        <CompassSection />

        <AnchorSection />

        <LiveUpdateSection />
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
