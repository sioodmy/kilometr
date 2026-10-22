import { useLayoutEffect, useRef } from 'react';
import { useStrings } from '../i18n';

export function PromiseSection() {
  const s = useStrings().promise;
  const section = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = section.current;
    if (!root) return;
    const lines = root.querySelectorAll<HTMLElement>('.promise-line');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let frame = 0;
    const update = () => {
      frame = 0;
      for (const line of lines) {
        const bounds = line.getBoundingClientRect();
        const distance = Math.min(window.innerHeight * 0.3, bounds.height + 80);
        const progress = reduced.matches
          ? 1
          : Math.max(0, Math.min(1, (window.innerHeight * 0.9 - bounds.top) / distance));
        const eased = progress * progress * (3 - 2 * progress);
        line.style.setProperty('--line-reveal', String(eased));
        line.style.setProperty('--line-shift', `${(1 - eased) * 115}%`);
      }
    };
    const schedule = () => {
      if (visible && !frame) frame = requestAnimationFrame(update);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    const resize = new ResizeObserver(update);
    observer.observe(root);
    resize.observe(root);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', update);
    reduced.addEventListener('change', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', update);
      reduced.removeEventListener('change', update);
    };
  }, []);

  return (
    <section className="promise section-shell" ref={section} aria-labelledby="promise-title">
      <h2 id="promise-title">
        {(['ads', 'free', 'forever'] as const).map((line) => (
          <span className={`promise-line promise-${line}`} key={line}>
            <span>{s[line]}</span>
          </span>
        ))}
      </h2>
    </section>
  );
}
