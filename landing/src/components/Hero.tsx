import { useEffect, useId, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import type { CityId } from '../../../src/cities';
import { useStrings } from '../i18n';
import { PLAY_URL } from '../data';
import { Phone } from './Phone';

const cities = [
  'wroclaw',
  'krakow',
  'warszawa',
  'poznan',
  'gzm',
  'lodz',
] as const satisfies readonly CityId[];

const routes = [
  'M-80 150H160Q180 150 195 165L385 355Q400 370 420 370H980Q1000 370 1015 355L1240 130Q1255 115 1275 115H1480',
  'M-80 510H200Q220 510 235 495L430 300Q445 285 465 285H955Q975 285 990 300L1230 540Q1245 555 1265 555H1480',
  'M180-60V195Q180 215 195 230L430 465Q445 480 445 500V770Q445 790 460 805L710 1055Q725 1070 745 1070H1480',
  'M1245-60V210Q1245 230 1230 245L1030 445Q1015 460 1015 480V790Q1015 810 1000 825L780 1045Q765 1060 765 1080V1200',
  'M-80 800H210Q230 800 245 785L360 670Q375 655 395 655H1010Q1030 655 1045 640L1150 535Q1165 520 1185 520H1480',
  'M-80 1030H130Q150 1030 165 1015L345 835Q360 820 380 820H1085Q1105 820 1120 835L1300 1015Q1315 1030 1335 1030H1480',
];

const stations = [
  [180, 150],
  [285, 255],
  [530, 370],
  [1100, 270],
  [330, 400],
  [1070, 380],
  [445, 580],
  [1015, 715],
  [270, 760],
  [1170, 520],
  [550, 820],
  [1210, 925],
];

export function Hero() {
  const s = useStrings();
  const hero = useRef<HTMLElement>(null);
  const routeId = useId();

  useEffect(() => {
    const element = hero.current;
    if (!element) return;
    const pointer = window.matchMedia(
      '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    );
    let frame = 0;
    let visible = true;
    const updateMotion = () => {
      element.dataset.motion = visible && !document.hidden ? 'running' : 'paused';
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updateMotion();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', updateMotion);
    updateMotion();

    const move = (event: PointerEvent) => {
      if (!pointer.matches || event.pointerType !== 'mouse') return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = element.getBoundingClientRect();
        element.style.setProperty(
          '--pointer-x',
          `${(event.clientX - bounds.left - bounds.width / 2) * 0.025}px`,
        );
        element.style.setProperty(
          '--pointer-y',
          `${(event.clientY - bounds.top - Math.min(bounds.height, 600) / 2) * 0.025}px`,
        );
      });
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      element.style.setProperty('--pointer-x', '0px');
      element.style.setProperty('--pointer-y', '0px');
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', reset);
    pointer.addEventListener('change', reset);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', updateMotion);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', reset);
      pointer.removeEventListener('change', reset);
    };
  }, []);

  return (
    <section className="hero" aria-labelledby="hero-title" ref={hero}>
      <div className="hero-brand brand">
        <img src="./icon.png" alt="" width="30" height="30" />
        <span>Kilometr</span>
      </div>
      <div className="hero-map" aria-hidden="true">
        <svg viewBox="0 0 1400 1100" preserveAspectRatio="xMidYMin slice" fill="none">
          <defs>
            {routes.map((route, index) => (
              <path key={route} id={`${routeId}-${index}`} d={route} pathLength="1000" />
            ))}
          </defs>
          <g className="hero-map-lines">
            {routes.map((route, index) => (
              <use key={route} href={`#${routeId}-${index}`} />
            ))}
          </g>
          <g className="hero-map-stations">
            {stations.map(([x, y]) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="4" />
            ))}
          </g>
          <g className="hero-map-trains">
            {[0, 2, 4].map((index) => (
              <use
                key={index}
                href={`#${routeId}-${index}`}
                className={`hero-train hero-train-${index}`}
              />
            ))}
          </g>
        </svg>
      </div>
      <div className="hero-cities" aria-hidden="true">
        {cities.map((city) => (
          <div className={`hero-city hero-city-${city}`} key={city}>
            <div className="hero-city-float">
              <div className="hero-city-mark">
                <img src={`./cities/${city}.webp`} alt="" width="100" height="60" />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="hero-copy">
        <h1 id="hero-title">
          {s.hero.title} <em>{s.hero.accent}</em> <span>{s.hero.titleEnd}</span>
        </h1>
        <p className="hero-body">{s.hero.body}</p>
        <div className="hero-actions">
          <a className="button button-primary" href={PLAY_URL}>
            <span className="play-symbol" aria-hidden="true" />
            {s.hero.play}
          </a>
          <a className="text-link" href="#mozliwosci">
            {s.hero.secondary}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="product-stage">
        <Phone screen="home" className="hero-phone" />
      </div>
    </section>
  );
}
