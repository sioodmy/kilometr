import { useEffect, useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import type { CityId } from '../../../src/cities';
import { useStrings } from '../i18n';
import { PlatformLinks } from './PlatformLinks';
import { Phone } from './Phone';

const cities = [
  'wroclaw',
  'krakow',
  'warszawa',
  'poznan',
  'gzm',
  'lodz',
] as const satisfies readonly CityId[];

export function Hero() {
  const s = useStrings();
  const hero = useRef<HTMLElement>(null);

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
          <span>
            {s.hero.title} <em>{s.hero.accent}</em>
          </span>
          <span>{s.hero.titleEnd}</span>
        </h1>
        <p className="hero-body">{s.hero.body}</p>
        <div className="hero-actions">
          <PlatformLinks />
          <a className="text-link" href="#mozliwosci">
            {s.hero.secondary}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
      </div>
      <div className="product-stage">
        <Phone className="hero-phone" />
      </div>
    </section>
  );
}
