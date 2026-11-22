import { ArrowUpRight, Code2, Coffee, Server, ShieldCheck } from 'lucide-react';
import { GITHUB_URL, COFFEE_URL } from '../data';
import { useWebLocale } from '../i18n';
import { useReleaseCopy } from '../landingCopy';

const POINT_ICONS = [Server, ShieldCheck, Code2] as const;

export function DonateSection() {
  const locale = useWebLocale();
  const copy = useReleaseCopy(locale).donate;

  return (
    <section
      id="wesprzyj"
      className="release-section donate-release"
      aria-labelledby="donate-title"
    >
      <div className="release-inner">
        <div className="donate-board">
          <div className="donate-copy">
            <h2 className="donate-title" id="donate-title">
              {copy.title}
            </h2>
            <p className="donate-body">{copy.body}</p>

            <ul className="donate-points">
              {copy.points.map((point, idx) => {
                const Icon = POINT_ICONS[idx % POINT_ICONS.length]!;
                return (
                  <li key={point} className="donate-point">
                    <span className="donate-point-icon" aria-hidden="true">
                      <Icon size={15} strokeWidth={2} />
                    </span>
                    <span>{point}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="donate-actions-pane">
            <a
              className="donate-cta-primary"
              href={COFFEE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Coffee size={18} strokeWidth={2.2} aria-hidden="true" />
              <span>{copy.ctaPrimary}</span>
              <ArrowUpRight size={16} strokeWidth={2.2} aria-hidden="true" />
            </a>

            <a
              className="donate-cta-secondary"
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Code2 size={16} strokeWidth={2} aria-hidden="true" />
              <span>{copy.ctaSecondary}</span>
              <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
            </a>

            <p className="donate-note">{copy.note}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
