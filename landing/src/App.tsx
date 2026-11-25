import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { setWebLocale, useStrings, useWebLocale, type Locale } from './i18n';
import { Hero } from './components/Hero';
import { ReleaseShowcase } from './components/ReleaseShowcase';
import { DonateSection } from './components/DonateSection';
import { PromiseSection } from './components/Promise';
import { ClosingSection } from './components/ClosingSection';
import { GITHUB_URL, OBTAINIUM_URL } from './data';

const loadCoverageSection = () => import('./components/CoverageSection');

const CoverageSection = lazy(() =>
  loadCoverageSection().then((m) => ({ default: m.CoverageSection })),
);
const SharedJourney = lazy(() => import('./components/SharedJourney'));
const InformationPage = lazy(() =>
  import('./components/InformationPage').then((m) => ({ default: m.InformationPage })),
);
const InstallPage = lazy(() =>
  import('./components/InstallPage').then((m) => ({ default: m.InstallPage })),
);
const ThemeStudioPage = lazy(() =>
  import('./components/ThemeStudioPage').then((m) => ({ default: m.ThemeStudioPage })),
);

function DisplaySettings() {
  const s = useStrings();
  const locale = useWebLocale();

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
    </div>
  );
}

function Landing() {
  return (
    <main id="main" tabIndex={-1}>
      <Hero />
      <ReleaseShowcase />
      <Suspense
        fallback={
          <section
            id="zasieg"
            className="release-section coverage-release"
            style={{ minHeight: '720px' }}
            aria-hidden="true"
          />
        }
      >
        <CoverageSection />
      </Suspense>
      <DonateSection />
      <PromiseSection />
      <ClosingSection />
    </main>
  );
}

export default function App() {
  const s = useStrings();
  const [hash, setHash] = useState(window.location.hash);
  const shared = hash.startsWith('#t=') || hash.startsWith('#trip');
  const page =
    hash === '#polityka'
      ? 'privacy'
      : hash === '#ios'
        ? 'ios'
        : hash === '#motyw' || hash === '#dziekuje'
          ? 'themeStudio'
          : null;
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    document.body.classList.toggle('is-shared-view', shared);
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = shared ? '#111414' : '#101713';
    return () => {
      document.body.classList.remove('is-shared-view');
    };
  }, [shared]);
  useEffect(() => {
    if (shared) return;
    document.title = page ? `${s[page].title} | Kilometr` : s.meta.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', page ? s[page].intro : s.meta.description);
  }, [page, s, shared]);
  // Prefetch sekcji zasięgu w bezczynności po pierwszym malowaniu Hero, bez blokowania LCP.
  useEffect(() => {
    if (page || shared) return;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(() => void loadCoverageSection(), { timeout: 1500 });
      return () => win.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(() => void loadCoverageSection(), 900);
    return () => window.clearTimeout(timer);
  }, [page, shared]);
  useEffect(() => {
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (page === 'themeStudio') {
      const meta = robots ?? document.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex, nofollow';
      if (!robots) document.head.appendChild(meta);
    } else {
      robots?.remove();
    }
  }, [page]);
  useEffect(() => {
    if (page || shared || !hash || hash === '#top') {
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (page || shared) document.getElementById('main')?.focus({ preventScroll: true });
    } else if (hash)
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
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById('main');
          main?.focus({ preventScroll: true });
          main?.scrollIntoView();
        }}
      >
        {s.skip}
      </a>
      <div id="top" />
      {shared ? (
        <Suspense
          fallback={<main id="main" className="section-shell" role="status" aria-busy="true" />}
        >
          <SharedJourney hash={hash} />
        </Suspense>
      ) : page === 'privacy' ? (
        <Suspense
          fallback={<main id="main" className="section-shell" role="status" aria-busy="true" />}
        >
          <InformationPage />
        </Suspense>
      ) : page === 'themeStudio' ? (
        <Suspense
          fallback={<main id="main" className="section-shell" role="status" aria-busy="true" />}
        >
          <ThemeStudioPage />
        </Suspense>
      ) : page ? (
        <Suspense
          fallback={<main id="main" className="section-shell" role="status" aria-busy="true" />}
        >
          <InstallPage />
        </Suspense>
      ) : (
        <Landing />
      )}
      {!shared && (
        <footer className="footer section-shell">
          <div className="footer-main">
            <a className="brand" href="#top">
              <img src="./icon.png" alt="" width={26} height={26} loading="lazy" decoding="async" />
              <span>Kilometr</span>
            </a>
            <p>{s.footer.tagline}</p>
            <nav aria-label={s.nav.label}>
              <a href="#polityka">{s.footer.privacy}</a>
              <a href={GITHUB_URL}>
                {s.footer.github}
                <ArrowUpRight size={13} aria-hidden="true" />
              </a>
              <a href={OBTAINIUM_URL}>
                {s.footer.obtainium}
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
      )}
    </>
  );
}
