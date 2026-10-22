import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { useStrings } from '../i18n';
import {
  GOOGLE_GROUP_URL,
  BETA_URL,
  IPA_URL,
  SIDELOADLY_URL,
  OBTAINIUM_URL,
  KOFI_URL,
} from '../data';
import { PlatformLinks } from './PlatformLinks';

export function InstallPage({ page }: { page: 'android' | 'ios' }) {
  const s = useStrings();
  const content = s[page];
  const steps =
    page === 'android'
      ? [
          { ...s.android.group, href: GOOGLE_GROUP_URL },
          { ...s.android.testing, href: BETA_URL },
        ]
      : [
          { ...s.ios.download, href: IPA_URL },
          { ...s.ios.tool, href: SIDELOADLY_URL },
          { ...s.ios.sign },
          { ...s.ios.open },
        ];

  return (
    <main className="install-page section-shell" id="main" tabIndex={-1}>
      <a className="text-link" href="#top">
        <ArrowLeft size={17} aria-hidden="true" />
        {s.footer.back}
      </a>
      <nav className="install-platforms" aria-label={s.install.platform}>
        <PlatformLinks current={page} />
      </nav>
      <h1>{content.title}</h1>
      <p className="install-intro">{content.intro}</p>
      <aside className="install-note" aria-labelledby="install-note-title">
        <h2 id="install-note-title">{content.noteTitle}</h2>
        <p>{content.noteBody}</p>
      </aside>
      <ol className="install-steps" role="list">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="install-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              {'href' in step && (
                <a
                  className="button button-primary"
                  href={step.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {step.action}
                  <ArrowUpRight size={17} aria-hidden="true" />
                  <span className="sr-only">{s.install.newTab}</span>
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <section className="install-help" aria-labelledby="install-help-title">
        <h2 id="install-help-title">{content.helpTitle}</h2>
        <p>{content.helpBody}</p>
      </section>
      {page === 'android' ? (
        <section className="install-alternative" aria-labelledby="alternative-title">
          <h2 id="alternative-title">{s.android.alternative.title}</h2>
          <p>{s.android.alternative.body}</p>
          <div className="install-options">
            <a className="button button-primary" href={OBTAINIUM_URL}>
              {s.android.alternative.obtainium}
            </a>
            <button className="button button-secondary" type="button" disabled>
              {s.android.alternative.fdroid}
              <span className="coming-soon">{s.android.alternative.soon}</span>
            </button>
          </div>
          <a className="text-link" href="./obtainium.json" download>
            {s.android.alternative.json}
          </a>
        </section>
      ) : (
        <section className="install-alternative" aria-labelledby="alternative-title">
          <h2 id="alternative-title">{s.ios.appStore.title}</h2>
          <p>{s.ios.appStore.body}</p>
          <p>{s.ios.appStore.supportBody}</p>
          <div className="install-options">
            <a className="button button-primary" href={KOFI_URL}>
              {s.closing.support}
            </a>
          </div>
        </section>
      )}
    </main>
  );
}
