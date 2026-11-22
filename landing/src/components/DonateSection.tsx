import { useEffect, useId, useRef, useState } from 'react';
import { COFFEE_URL } from '../data';
import { useWebLocale } from '../i18n';
import { useReleaseCopy } from '../landingCopy';

const HEART_PATH =
  'M 160 55 C 150 38, 122 39, 122 64 C 122 86, 146 101, 160 113 C 174 101, 198 86, 198 64 C 198 39, 170 38, 160 55 Z';

const MINI_HEART_PATH =
  'M 0 -2.6 C -1.6 -5.4, -6 -5.1, -6 -1.2 C -6 2.2, -2.2 4.6, 0 6.5 C 2.2 4.6, 6 2.2, 6 -1.2 C 6 -5.1, 1.6 -5.4, 0 -2.6 Z';

/* Ilustracja SVG łącząca motyw linii komunikacyjnej Kilometra z animowanym sercem. */
function DonateHeartArt({ excited }: { excited: boolean }) {
  const uid = useId().replace(/:/g, '');
  const glowId = `donate-glow-${uid}`;
  const fillId = `donate-fill-${uid}`;
  const routeLeftId = `donate-route-l-${uid}`;
  const routeRightId = `donate-route-r-${uid}`;

  return (
    <div className="donate-art" data-excited={excited ? 'true' : undefined} aria-hidden="true">
      <svg
        className="donate-heart-svg"
        viewBox="0 0 320 148"
        width="320"
        height="148"
        fill="none"
        focusable="false"
      >
        <defs>
          <radialGradient id={glowId} cx="50%" cy="52%" r="48%">
            <stop offset="0%" stopColor="#ff6b84" stopOpacity="0.24" />
            <stop offset="58%" stopColor="#ff6b84" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#ff6b84" stopOpacity="0" />
          </radialGradient>

          <linearGradient id={fillId} x1="130" y1="42" x2="192" y2="114" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ff9fb0" />
            <stop offset="52%" stopColor="#ff6680" />
            <stop offset="100%" stopColor="#e24363" />
          </linearGradient>

          <linearGradient id={routeLeftId} x1="16" y1="76" x2="124" y2="76" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7fdbb1" stopOpacity="0" />
            <stop offset="45%" stopColor="#7fdbb1" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#ff8da0" stopOpacity="0.48" />
          </linearGradient>

          <linearGradient id={routeRightId} x1="196" y1="76" x2="304" y2="76" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ff8da0" stopOpacity="0.48" />
            <stop offset="55%" stopColor="#7fdbb1" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#7fdbb1" stopOpacity="0" />
          </linearGradient>
        </defs>

        <ellipse className="donate-heart-aura" cx="160" cy="78" rx="92" ry="62" fill={`url(#${glowId})`} />

        <g className="donate-routes">
          <path
            className="donate-route-base"
            d="M 16 76 C 48 76, 62 62, 86 62 C 102 62, 108 76, 124 76"
            stroke={`url(#${routeLeftId})`}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            className="donate-route-base"
            d="M 196 76 C 212 76, 218 90, 234 90 C 258 90, 272 76, 304 76"
            stroke={`url(#${routeRightId})`}
            strokeWidth="1.5"
            strokeLinecap="round"
          />

          <path
            className="donate-route-pulse donate-route-pulse-left"
            d="M 16 76 C 48 76, 62 62, 86 62 C 102 62, 108 76, 124 76"
            pathLength={100}
          />
          <path
            className="donate-route-pulse donate-route-pulse-right"
            d="M 304 76 C 272 76, 258 90, 234 90 C 218 90, 212 76, 196 76"
            pathLength={100}
          />

          <circle className="donate-stop" cx="24" cy="76" r="2.75" />
          <circle className="donate-stop donate-stop-mid" cx="86" cy="62" r="3.25" />
          <circle className="donate-stop donate-stop-mid" cx="234" cy="90" r="3.25" />
          <circle className="donate-stop" cx="296" cy="76" r="2.75" />
        </g>

        <g className="donate-heart-rings">
          <path className="donate-ring donate-ring-outer" d={HEART_PATH} />
          <path className="donate-ring donate-ring-inner" d={HEART_PATH} />
        </g>

        <g className="donate-heart-core">
          <path className="donate-heart-shape" d={HEART_PATH} fill={`url(#${fillId})`} />
          <path
            className="donate-heart-trace"
            d={HEART_PATH}
            pathLength={100}
          />
          <path
            className="donate-heart-sheen"
            d="M 134 62 C 134 52, 143 48, 150 51"
            strokeLinecap="round"
          />
        </g>

        <g className="donate-sparks">
          <g transform="translate(132 34)">
            <g className="donate-spark donate-spark-1">
              <path d={MINI_HEART_PATH} transform="rotate(-14) scale(0.95)" />
            </g>
          </g>
          <g transform="translate(192 31)">
            <g className="donate-spark donate-spark-2">
              <path d={MINI_HEART_PATH} transform="rotate(16) scale(0.8)" />
            </g>
          </g>
          <g transform="translate(168 20)">
            <g className="donate-spark donate-spark-3">
              <path d={MINI_HEART_PATH} transform="rotate(6) scale(0.65)" />
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}

/* Sekcja wsparcia projektu na stronie głównej z animowanym sercem i bezpośrednim CTA. */
export function DonateSection() {
  const locale = useWebLocale();
  const copy = useReleaseCopy(locale).donate;
  const sectionRef = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  const [excited, setExcited] = useState(false);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node || !('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
      },
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="wesprzyj"
      ref={sectionRef}
      className="release-section donate-section"
      data-in-view={inView ? 'true' : 'false'}
      aria-labelledby="donate-title"
    >
      <div className="donate-stage">
        <DonateHeartArt excited={excited} />

        <h2 className="donate-title" id="donate-title">
          {copy.title}
        </h2>

        <p className="donate-body">{copy.body}</p>

        <div className="donate-action">
          <a
            className="donate-cta"
            href={COFFEE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={() => setExcited(true)}
            onMouseLeave={() => setExcited(false)}
            onFocus={() => setExcited(true)}
            onBlur={() => setExcited(false)}
          >
            <svg
              className="donate-cta-heart"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M12 20.4c-.3 0-.6-.1-.8-.3C6.5 16.2 3.2 13.1 3.2 9.1c0-3 2.3-5.3 5.2-5.3 1.5 0 2.9.7 3.6 1.8.7-1.1 2.1-1.8 3.6-1.8 2.9 0 5.2 2.3 5.2 5.3 0 4-3.3 7.1-8 11-.2.2-.5.3-.8.3Z" />
            </svg>
            <span>{copy.cta}</span>
          </a>

          <p className="donate-note">{copy.note}</p>
        </div>
      </div>
    </section>
  );
}
