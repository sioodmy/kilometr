import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { useStrings } from '../i18n';
import { PRIVACY_CONTACT_URL, PRIVACY_SECTIONS } from '../../../src/privacy';

export function InformationPage() {
  const s = useStrings();
  return (
    <main className="information-page section-shell" id="main" tabIndex={-1}>
      <a className="text-link" href="#top">
        <ArrowLeft size={17} aria-hidden="true" />
        {s.footer.back}
      </a>
      <h1>{s.privacy.title}</h1>
      <p className="information-intro">{s.privacy.intro}</p>
      {PRIVACY_SECTIONS.map((section) => (
        <section key={section}>
          <h2>{s.privacy[`${section}Title`]}</h2>
          <p>{s.privacy[`${section}Body`]}</p>
        </section>
      ))}
      <a className="text-link" href={PRIVACY_CONTACT_URL}>
        {s.privacy.contact}
        <ArrowUpRight size={17} aria-hidden="true" />
      </a>
    </main>
  );
}
