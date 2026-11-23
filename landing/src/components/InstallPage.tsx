import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { useStrings } from '../i18n';
import { IPA_URL, SIDELOADLY_URL, COFFEE_URL } from '../data';
import { PlatformLinks } from './PlatformLinks';

export function InstallPage() {
  const s = useStrings();
  const content = s.ios;
  const steps = [
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
        <PlatformLinks current="ios" />
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
      <section className="install-alternative" aria-labelledby="alternative-title">
        <h2 id="alternative-title">{s.ios.appStore.title}</h2>
        <p>{s.ios.appStore.body}</p>
        <p>{s.ios.appStore.supportBody}</p>
        <div className="install-options">
          <a className="button button-primary" href={COFFEE_URL}>
            {s.closing.support}
          </a>
        </div>
      </section>
    </main>
  );
}
