import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown, Coffee } from 'lucide-react';
import { setWebLocale, useStrings, useShareStrings, useWebLocale, type Locale } from './i18n';
import { Hero } from './components/Hero';
import { JourneyDemo } from './components/JourneyDemo';
import { TransitBackdrop } from './components/TransitBackdrop';
import { PromiseSection } from './components/Promise';
import { InformationPage } from './components/InformationPage';
import { InstallPage } from './components/InstallPage';
import { PlatformLinks } from './components/PlatformLinks';
import { GITHUB_URL, KOFI_URL } from './data';

const SharedJourney = lazy(() => import('./components/SharedJourney'));

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
  const s = useStrings();
  return (
    <main id="main" tabIndex={-1}>
      <div className="landing-story">
        <TransitBackdrop />
        <Hero />
        <JourneyDemo />
      </div>
      <PromiseSection />
      <section
        id="pobierz"
        className="closing section-shell reveal"
        aria-labelledby="closing-title"
      >
        <h2 id="closing-title">{s.closing.title}</h2>
        <p className="section-body">{s.closing.body}</p>
        <div className="closing-actions">
          <PlatformLinks />
          <a className="text-link closing-support" href={KOFI_URL}>
            <Coffee size={18} aria-hidden="true" />
            <span>{s.closing.support}</span>
          </a>
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
  const page =
    hash === '#polityka'
      ? 'privacy'
      : hash === '#android' || hash === '#beta'
        ? 'android'
        : hash === '#ios'
          ? 'ios'
          : null;
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
          fallback={
            <main id="main" className="section-shell" role="status">
              {shareStrings.loading}
            </main>
          }
        >
          <SharedJourney hash={hash} />
        </Suspense>
      ) : page === 'privacy' ? (
        <InformationPage />
      ) : page ? (
        <InstallPage page={page} />
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
