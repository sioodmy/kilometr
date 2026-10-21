import { lazy, Suspense, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  Coffee,
  Github,
  Moon,
  Plane,
  Sun,
  TramFront,
  WifiOff,
} from 'lucide-react';
import { setWebLocale, useStrings, useShareStrings, useWebLocale, type Locale } from './i18n';
import { Phone } from './components/Phone';
import { Hero } from './components/Hero';
import { Coverage } from './components/Coverage';
import { InformationPage } from './components/InformationPage';
import {
  STABLE_RELEASE_URL,
  GITHUB_URL,
  KOFI_URL,
  OBTAINIUM_URL,
  PLAY_URL,
  RELEASES_URL,
} from './data';

const SharedJourney = lazy(() => import('./components/SharedJourney'));

function PlayLink({ className = '' }: { className?: string }) {
  const s = useStrings();
  return (
    <a className={`button button-primary ${className}`} href={PLAY_URL}>
      <span className="play-symbol" aria-hidden="true" />
      {s.hero.play}
    </a>
  );
}

function DisplaySettings() {
  const s = useStrings();
  const locale = useWebLocale();
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem('kilometr.website.theme');
      } catch {}
      if (!saved) {
        document.documentElement.dataset.theme = media.matches ? 'dark' : 'light';
        setDark(media.matches);
      }
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  function toggleTheme() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try {
      localStorage.setItem('kilometr.website.theme', next ? 'dark' : 'light');
    } catch {}
    setDark(next);
  }

  return (
    <div className="display-settings">
      <label className="language-select">
        <span className="sr-only">{s.language}</span>
        <select value={locale} onChange={(event) => setWebLocale(event.target.value as Locale)}>
          <option value="pl">PL</option>
          <option value="en">EN</option>
          <option value="de">DE</option>
          <option value="uk">UK</option>
        </select>
        <ChevronDown size={12} aria-hidden="true" />
      </label>
      <button
        className="icon-button theme-button"
        type="button"
        onClick={toggleTheme}
        aria-label={dark ? s.theme.light : s.theme.dark}
      >
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </div>
  );
}

function Features() {
  const s = useStrings().features;
  const [active, setActive] = useState<'plan' | 'saved' | 'ride'>('plan');
  const tabs = ['plan', 'saved', 'ride'] as const;
  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActive(tabs[next]);
    document.getElementById(`tab-${tabs[next]}`)?.focus();
  }
  return (
    <section id="mozliwosci" className="features section-shell">
      <div className="feature-tabs reveal" role="tablist" aria-label={s.label}>
        {tabs.map((tab, index) => (
          <button
            type="button"
            role="tab"
            id={`tab-${tab}`}
            aria-selected={active === tab}
            aria-controls={`panel-${tab}`}
            tabIndex={active === tab ? 0 : -1}
            key={tab}
            onClick={() => setActive(tab)}
            onKeyDown={(event) => moveTab(event, index)}
          >
            {s[tab]}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab}
          id={`panel-${tab}`}
          className="feature-panel"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          hidden={active !== tab}
          tabIndex={0}
        >
          <div className="feature-text">
            <h2>{s[`${tab}Title`]}</h2>
            <p className="section-body">{s[`${tab}Body`]}</p>
            <p className="feature-detail">{s[`${tab}Detail`]}</p>
          </div>
          <div className={`feature-visual feature-visual-${tab}`}>
            <span className="feature-word" aria-hidden="true">
              {s[tab]}
            </span>
            <Phone screen={tab === 'plan' ? 'routes' : tab === 'saved' ? 'home' : 'trip'} />
          </div>
        </div>
      ))}
    </section>
  );
}

function Landing() {
  const s = useStrings();
  return (
    <main id="main" tabIndex={-1}>
      <Hero />

      <section className="intro section-shell reveal">
        <TramFront className="intro-icon" strokeWidth={1.5} aria-hidden="true" />
        <h2>{s.intro.title}</h2>
        <p className="section-body">{s.intro.body}</p>
      </section>
      <Features />

      <section className="offline section-shell">
        <div className="offline-visual reveal">
          <div className="offline-ticket">
            <div className="ticket-top">
              <img src="./icon.png" alt="" width="38" height="38" />
              <span>Kilometr</span>
              <WifiOff size={23} aria-hidden="true" />
            </div>
            <div className="ticket-body">
              <span>{s.offline.airplane}</span>
              <Plane className="ticket-plane" strokeWidth={1.3} aria-hidden="true" />
              <strong>{s.offline.ready}</strong>
            </div>
            <div className="ticket-bottom">
              <span>
                <Check />
                {s.offline.timetable}
              </span>
              <span>
                <Check />
                {s.offline.maps}
              </span>
            </div>
          </div>
        </div>
        <div className="offline-copy reveal">
          <p className="eyebrow">{s.offline.eyebrow}</p>
          <h2>{s.offline.title}</h2>
          <p className="section-body">{s.offline.body}</p>
          <p className="offline-note">{s.offline.note}</p>
        </div>
      </section>

      <Coverage />

      <section className="principles section-shell">
        <h2 className="reveal">{s.principles.title}</h2>
        <div className="principles-grid">
          {(['free', 'ads', 'account', 'open'] as const).map((item) => (
            <div className="principle reveal" key={item}>
              <h3>{s.principles[item]}</h3>
              <p>{s.principles[`${item}Body`]}</p>
            </div>
          ))}
        </div>
        <a className="text-link" href={GITHUB_URL}>
          <Github size={17} aria-hidden="true" />
          {s.principles.source}
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </section>

      <section
        id="wsparcie"
        className="donation section-shell reveal"
        aria-labelledby="donation-title"
      >
        <div className="donation-copy">
          <Coffee className="donation-icon" strokeWidth={1.5} aria-hidden="true" />
          <h2 id="donation-title">{s.donation.title}</h2>
          <p className="section-body">{s.donation.body}</p>
        </div>
        <a className="button button-support" href={KOFI_URL}>
          {s.donation.cta}
          <ArrowUpRight size={17} aria-hidden="true" />
        </a>
      </section>

      <section id="pobierz" className="download-section section-shell reveal">
        <img
          className="download-icon"
          src="./icon.png"
          alt=""
          width="88"
          height="88"
          loading="lazy"
        />
        <h2>{s.download.title}</h2>
        <p className="section-body">{s.download.body}</p>
        <PlayLink />
        <p className="download-platform">{s.download.android}</p>
        <div className="download-alternatives">
          <p>{s.download.alternatives}</p>
          <div>
            <a href={STABLE_RELEASE_URL}>
              <ArrowDownToLine size={17} aria-hidden="true" />
              {s.download.apk}
              <span className="sr-only">. {s.download.github}</span>
            </a>
            <a href={RELEASES_URL}>
              {s.download.nightly}
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
            <a href={OBTAINIUM_URL} title={s.download.obtainiumHelp}>
              {s.download.obtainium}
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const s = useStrings();
  const shareStrings = useShareStrings();
  const [hash, setHash] = useState(window.location.hash);
  const shared = hash.startsWith('#trip');
  const page = hash === '#polityka' ? 'privacy' : hash === '#raport' ? 'report' : null;
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    document.title = shared
      ? `${shareStrings.pageTitle} | ${shareStrings.brand}`
      : page
        ? `${s[page].title} | Kilometr`
        : s.meta.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', page ? s[page].intro : s.meta.description);
  }, [page, s, shared, shareStrings]);
  useEffect(() => {
    if (page || shared) window.scrollTo(0, 0);
    else if (hash)
      requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView());
  }, [page, hash, shared]);
  useEffect(() => {
    if (
      page ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window)
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08 },
    );
    document.querySelectorAll('.reveal').forEach((element) => {
      observer.observe(element);
      element.classList.add('will-reveal');
    });
    return () => observer.disconnect();
  }, [page]);

  return (
    <>
      <a className="skip-link" href="#main">
        {s.skip}
      </a>
      <div id="top" />
      {shared ? (
        <Suspense
          fallback={
            <main id="main" className="section-shell" role="status">
              {shareStrings.loading}
            </main>
          }
        >
          <SharedJourney hash={hash} />
        </Suspense>
      ) : page ? (
        <InformationPage page={page} />
      ) : (
        <Landing />
      )}
      <footer className="footer section-shell">
        <div className="footer-main">
          <a className="brand" href="#top">
            <img src="./icon.png" alt="" width="26" height="26" />
            <span>Kilometr</span>
          </a>
          <p>{s.footer.tagline}</p>
          <nav aria-label={s.nav.label}>
            <a href="#polityka">{s.footer.privacy}</a>
            <a href="#raport">{s.footer.report}</a>
            <a href={GITHUB_URL}>
              {s.footer.github}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Kilometr</span>
          <DisplaySettings />
          <a href={`${GITHUB_URL}/blob/main/LICENSE`}>{s.footer.license}</a>
        </div>
      </footer>
    </>
  );
}
