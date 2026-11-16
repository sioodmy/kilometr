import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useStrings } from '../i18n';

const SCREENSHOTS = [
  './screenshots/mainscreen.png',
  './screenshots/listapolaczen.png',
  './screenshots/polaczenie.png',
  './screenshots/sharing.png',
  './screenshots/alert.png',
] as const;

const STORY_DURATION_MS = 6500;

export function ShowcaseDemo() {
  const s = useStrings();
  const showcase = s.showcase;
  const slides = showcase.slides;

  const [activeIndex, setActiveIndex] = useState(0);
  const [storyRunId, setStoryRunId] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const sectionRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const totalSlides = slides.length;
  const activeSlide = slides[activeIndex] ?? slides[0];

  useEffect(() => {
    const section = sectionRef.current;
    const story = section?.parentElement;
    if (!section || !story) return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);

    let raf = 0;
    const update = () => {
      raf = 0;
      if (mq.matches) {
        story.style.setProperty('--journey-progress', '1');
        return;
      }
      const rect = section.getBoundingClientRect();
      const total = Math.max(1, window.innerHeight * 0.8 + rect.height * 0.45);
      const raw = (window.innerHeight * 0.85 - rect.top) / total;
      const clamped = Math.max(0, Math.min(1, raw));
      story.style.setProperty('--journey-progress', clamped.toFixed(4));
    };

    const schedule = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    const onMotionChange = () => {
      setReducedMotion(mq.matches);
      schedule();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(Boolean(entry?.isIntersecting));
      },
      { threshold: 0.2 },
    );

    observer.observe(section);
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    mq.addEventListener('change', onMotionChange);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      mq.removeEventListener('change', onMotionChange);
    };
  }, []);

  const selectSlide = useCallback(
    (nextIndex: number, moveFocus = false) => {
      const normalized = (nextIndex + totalSlides) % totalSlides;
      setActiveIndex(normalized);
      setStoryRunId((id) => id + 1);
      if (moveFocus) {
        requestAnimationFrame(() => {
          tabRefs.current[normalized]?.focus();
        });
      }
    },
    [totalSlides],
  );

  const shouldAutoAdvance = isInView && !isPaused && !reducedMotion;

  useEffect(() => {
    if (!shouldAutoAdvance) return;
    const timer = window.setTimeout(() => {
      setActiveIndex((prev) => (prev + 1) % totalSlides);
      setStoryRunId((id) => id + 1);
    }, STORY_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [shouldAutoAdvance, activeIndex, storyRunId, totalSlides]);

  const handleBoxKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        selectSlide(activeIndex + 1, event.currentTarget.getAttribute('role') === 'tab');
        break;
      case 'ArrowLeft':
        event.preventDefault();
        selectSlide(activeIndex - 1, event.currentTarget.getAttribute('role') === 'tab');
        break;
      case 'Home':
        event.preventDefault();
        selectSlide(0, event.currentTarget.getAttribute('role') === 'tab');
        break;
      case 'End':
        event.preventDefault();
        selectSlide(totalSlides - 1, event.currentTarget.getAttribute('role') === 'tab');
        break;
      default:
        break;
    }
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      selectSlide(dx < 0 ? activeIndex + 1 : activeIndex - 1);
    }
  };

  return (
    <section
      id="mozliwosci"
      ref={sectionRef}
      className="showcase-demo section-shell reveal"
      aria-labelledby="showcase-title"
    >
      <div
        className={`showcase-box${shouldAutoAdvance ? ' is-playing' : ''}`}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onFocusCapture={() => setIsPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setIsPaused(false);
          }
        }}
        onKeyDown={handleBoxKeyDown}
      >
        <div className="showcase-story-chrome">
          <div
            className="showcase-progress-list"
            role="tablist"
            aria-label={showcase.tabsLabel}
          >
            {slides.map((slide, index) => {
              const selected = index === activeIndex;
              const completed = index < activeIndex;
              return (
                <button
                  key={slide.id}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`showcase-tab-${slide.id}`}
                  aria-selected={selected}
                  aria-controls="showcase-panel"
                  aria-label={`${showcase.stepCounter(index + 1, totalSlides)}: ${slide.shortLabel}`}
                  tabIndex={selected ? 0 : -1}
                  className={
                    selected
                      ? 'showcase-progress-seg is-active'
                      : completed
                        ? 'showcase-progress-seg is-done'
                        : 'showcase-progress-seg'
                  }
                  onClick={() => selectSlide(index)}
                  onKeyDown={handleBoxKeyDown}
                >
                  <span className="showcase-progress-track" aria-hidden="true">
                    <span
                      key={selected ? `run-${storyRunId}` : 'idle'}
                      className="showcase-progress-fill"
                    />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="showcase-story-meta">
            <div className="showcase-story-identity">
              <img src="./icon.png" alt="" width={24} height={24} className="showcase-story-avatar" />
              <span className="showcase-story-tag">{activeSlide.shortLabel}</span>
            </div>
            <span className="showcase-counter" aria-live="polite">
              {showcase.stepCounter(activeIndex + 1, totalSlides)}
            </span>
          </div>
        </div>

        <div className="showcase-body">
          <div
            id="showcase-panel"
            role="tabpanel"
            aria-labelledby={`showcase-tab-${activeSlide.id}`}
            className="showcase-editorial"
          >
            <h2 id="showcase-title" className="showcase-heading">
              {activeSlide.title}
            </h2>
            <p className="showcase-slide-body">{activeSlide.body}</p>
          </div>

          <div
            className="showcase-stage"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="showcase-phone" aria-label={activeSlide.imageAlt}>
              <div className="showcase-phone-chassis">
                <span className="showcase-hw-btn showcase-hw-vol-up" aria-hidden="true" />
                <span className="showcase-hw-btn showcase-hw-vol-down" aria-hidden="true" />
                <span className="showcase-hw-btn showcase-hw-power" aria-hidden="true" />
                <div className="showcase-phone-bezel">
                  <span className="showcase-earpiece" aria-hidden="true" />
                  <div className="showcase-screen">
                    <span className="showcase-punch" aria-hidden="true" />
                    {slides.map((slide, index) => {
                      const isCurrent = index === activeIndex;
                      return (
                        <img
                          key={slide.id}
                          src={SCREENSHOTS[index]}
                          alt={isCurrent ? slide.imageAlt : ''}
                          aria-hidden={!isCurrent}
                          className={isCurrent ? 'showcase-shot is-active' : 'showcase-shot'}
                          width={720}
                          height={1600}
                          loading={index === 0 ? 'eager' : 'lazy'}
                          decoding="async"
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <button
              type="button"
              className="showcase-tap showcase-tap-prev"
              aria-label={showcase.prevLabel}
              onClick={() => selectSlide(activeIndex - 1)}
            >
              <span className="showcase-tap-chevron" aria-hidden="true">
                <ChevronLeft size={20} />
              </span>
            </button>
            <button
              type="button"
              className="showcase-tap showcase-tap-next"
              aria-label={showcase.nextLabel}
              onClick={() => selectSlide(activeIndex + 1)}
            >
              <span className="showcase-tap-chevron" aria-hidden="true">
                <ChevronRight size={20} />
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
