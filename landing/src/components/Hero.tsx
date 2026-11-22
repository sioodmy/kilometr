import { useEffect, useRef } from 'react';
import { useWebLocale } from '../i18n';
import { useReleaseCopy } from '../landingCopy';
import { HeroMapStage } from './HeroMapStage';
import { Phone } from './Phone';
import { PlatformLinks } from './PlatformLinks';

export function Hero() {
  const locale = useWebLocale();
  const copy = useReleaseCopy(locale);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;

    const update = () => {
      raf = 0;
      if (reduced.matches) {
        stage.style.setProperty('--hero-scroll', '1');
        return;
      }
      const rect = stage.getBoundingClientRect();
      const progress = Math.max(
        0,
        Math.min(1, (window.innerHeight * 0.92 - rect.top) / (window.innerHeight * 0.62)),
      );
      stage.style.setProperty('--hero-scroll', progress.toFixed(4));
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    reduced.addEventListener('change', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      reduced.removeEventListener('change', update);
    };
  }, []);

  return (
    <section className="hero-release" aria-labelledby="hero-title">
      <HeroMapStage
        originLabel={copy.hero.mapOrigin}
        destinationLabel={copy.hero.mapDestination}
      />

      <header className="release-nav">
        <a className="release-brand" href="#top">
          <img
            className="release-brand-mark"
            src="./icon.png"
            width="28"
            height="28"
            alt=""
            aria-hidden="true"
          />
          <span>Kilometr</span>
        </a>

      </header>

      <div className="hero-content">
        <h1 className="hero-title" id="hero-title">
          <span className="hero-line">
            <span>{copy.hero.titleLine1}</span>
          </span>
          <span className="hero-line hero-line-accent">
            <span>{copy.hero.titleAccent}</span>
          </span>
        </h1>

        <p className="hero-subtitle">{copy.hero.subtitle}</p>

        <div className="hero-cta">
          <PlatformLinks />
        </div>
      </div>

      <div className="hero-hardware-stage" ref={stageRef}>
        <div className="hero-hardware-trio">
          <div className="hero-flank hero-flank-left" aria-hidden="true">
            <Phone label={copy.hero.phoneLeftAlt} statusTime="08:51">
              <img
                className="pixel-shot"
                src="./screenshots/routes-urban.webp"
                alt=""
                width="720"
                height="1600"
                loading="eager"
                decoding="async"
              />
            </Phone>
          </div>

          <div className="hero-centerpiece">
            <Phone label={copy.hero.phoneMainAlt} statusTime="08:54">
              <img
                className="pixel-shot"
                src="./screenshots/details-urban.webp"
                alt=""
                width="720"
                height="1600"
                fetchPriority="high"
                decoding="async"
              />
            </Phone>
          </div>

          <div className="hero-flank hero-flank-right" aria-hidden="true">
            <Phone label={copy.hero.phoneRightAlt} statusTime="09:32">
              <img
                className="pixel-shot"
                src="./screenshots/details-ic.webp"
                alt=""
                width="720"
                height="1600"
                loading="eager"
                decoding="async"
              />
            </Phone>
          </div>
        </div>
      </div>
    </section>
  );
}
