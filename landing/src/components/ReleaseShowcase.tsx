import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useWebLocale } from '../i18n';
import { useReleaseCopy } from '../landingCopy';
import { Phone } from './Phone';

const URBAN_TRANSFER_SHOTS = [
  './screenshots/transfer-safe.webp',
  './screenshots/transfer-alt.webp',
] as const;

const RAIL_TRANSFER_SHOTS = [
  './screenshots/routes-rail.webp',
  './screenshots/details-ic.webp',
  './screenshots/transfer-rail.webp',
] as const;

const DISRUPTIONS_SHOT = './screenshots/news-disruptions.webp';
const STORY_HOVER_DELAY_MS = 1000;

function useIsMobileLayout() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 960px)').matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)');
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

export function ReleaseShowcase() {
  const locale = useWebLocale();
  const copy = useReleaseCopy(locale);
  const isMobile = useIsMobileLayout();

  // Act II: sticky story choreography on desktop, scroll-driven pinned IG Stories on mobile
  const storySectionRef = useRef<HTMLElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const storyIgRef = useRef<HTMLDivElement>(null);
  const [storyBeat, setStoryBeat] = useState(0);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Act III: ambient cycling on desktop (2 phones) + unified single-phone sequence on mobile
  const transfersRef = useRef<HTMLElement>(null);
  const [transfersInView, setTransfersInView] = useState(false);
  const [urbanIdx, setUrbanIdx] = useState(0);
  const [railIdx, setRailIdx] = useState(0);

  // Mobile: ochrona przesiadek i utrudnienia to kolejne rozdziały historii zamiast osobnych sekcji.
  const chapters = useMemo(() => {
    if (!isMobile) return copy.story.chapters;
    const extra = [
      {
        id: 'transfers-urban',
        tag: copy.transfers.urbanLabel,
        title: copy.transfers.urbanTitle,
        body: copy.transfers.urbanBody,
        shot: URBAN_TRANSFER_SHOTS[1],
        alt: copy.transfers.urbanAlts[1],
        statusTime: '09:07',
      },
      {
        id: 'transfers-rail',
        tag: copy.transfers.railLabel,
        title: copy.transfers.railTitle,
        body: copy.transfers.railBody,
        shot: RAIL_TRANSFER_SHOTS[2],
        alt: copy.transfers.railAlts[2],
        statusTime: '09:07',
      },
      {
        id: 'disruptions',
        tag: copy.disruptions.title,
        title: copy.disruptions.title,
        body: copy.disruptions.body,
        shot: DISRUPTIONS_SHOT,
        alt: copy.disruptions.phoneAlt,
        statusTime: '09:26',
      },
    ];
    const base = copy.story.chapters.length;
    return [
      ...copy.story.chapters,
      ...extra.map((c, i) => ({ ...c, number: String(base + i + 1).padStart(2, '0') })),
    ];
  }, [isMobile, copy]);
  const storyCount = chapters.length;

  const goStory = useCallback(
    (nextIndex: number) => {
      const wrapped = ((nextIndex % storyCount) + storyCount) % storyCount;
      setStoryBeat(wrapped);
    },
    [storyCount],
  );

  // Desktop-only scroll spy for sticky story choreography
  useEffect(() => {
    if (isMobile) return;
    const el = storyRef.current;
    if (!el) return;
    let raf = 0;

    const update = () => {
      raf = 0;
      const cards = el.querySelectorAll<HTMLElement>('[data-story-beat]');
      if (!cards.length) return;
      const anchor = window.innerHeight * 0.44;
      let bestIdx = 0;
      let bestDist = Infinity;
      cards.forEach((card, idx) => {
        const rect = card.getBoundingClientRect();
        const center = rect.top + rect.height * 0.5;
        const dist = Math.abs(center - anchor);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      });
      setStoryBeat(bestIdx);
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [isMobile]);

  // Desktop: hover przez sekundę przełącza rozdział, bo sam scroll spy łatwo przeoczyć.
  const [pendingBeat, setPendingBeat] = useState<number | null>(null);
  const hoverTimerRef = useRef(0);

  const cancelBeatHover = useCallback(() => {
    window.clearTimeout(hoverTimerRef.current);
    setPendingBeat(null);
  }, []);

  const startBeatHover = useCallback(
    (idx: number) => {
      window.clearTimeout(hoverTimerRef.current);
      if (idx === storyBeat) {
        setPendingBeat(null);
        return;
      }
      setPendingBeat(idx);
      hoverTimerRef.current = window.setTimeout(() => {
        setPendingBeat(null);
        setStoryBeat(idx);
      }, STORY_HOVER_DELAY_MS);
    },
    [storyBeat],
  );

  const selectBeat = useCallback((idx: number) => {
    window.clearTimeout(hoverTimerRef.current);
    setPendingBeat(null);
    setStoryBeat(idx);
  }, []);

  useEffect(() => () => window.clearTimeout(hoverTimerRef.current), []);

  // Wskaźnik aktywnego rozdziału przeskakuje między kartami (pozycja liczona z layoutu).
  const storyBeatsRef = useRef<HTMLDivElement>(null);
  const storyIndicatorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (isMobile) return;
    const list = storyBeatsRef.current;
    const indicator = storyIndicatorRef.current;
    if (!list || !indicator) return;

    const place = () => {
      const card = list.querySelector<HTMLElement>(`[data-story-beat="${storyBeat}"]`);
      if (!card) return;
      indicator.style.transform = `translateY(${card.offsetTop}px)`;
      indicator.style.height = `${card.offsetHeight}px`;
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => observer.disconnect();
  }, [isMobile, storyBeat]);

  // Mobile: historia działa jak kotwica. Po wjechaniu w ekran dociąga się do góry i przechodzi
  // w pełny ekran, aż do końca ostatniej karty albo do pierwszego pionowego gestu usera.
  const [immersive, setImmersive] = useState(false);
  const storyDoneRef = useRef(false);

  const exitImmersive = useCallback(() => {
    storyDoneRef.current = true;
    setImmersive(false);
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    const root = storyIgRef.current;
    if (!root) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let anchored = false;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio < 0.05) {
          anchored = false;
          storyDoneRef.current = false;
          setImmersive(false);
          return;
        }
        if (
          !anchored &&
          !storyDoneRef.current &&
          entry.intersectionRatio >= 0.35 &&
          entry.boundingClientRect.top > 0
        ) {
          anchored = true;
          setStoryBeat(0);
          setImmersive(true);
          root.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        }
      },
      { threshold: [0, 0.05, 0.35] },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [isMobile]);

  useEffect(() => {
    if (!immersive) return;
    let startY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY;
      if (startY !== null && y !== undefined && Math.abs(y - startY) > 24) exitImmersive();
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > 8) exitImmersive();
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('wheel', onWheel);
    };
  }, [immersive, exitImmersive]);

  const handleStoryFillEnd = () => {
    if (storyBeat < storyCount - 1) goStory(storyBeat + 1);
    else exitImmersive();
  };

  // Observe Transfer section visibility
  useEffect(() => {
    const el = transfersRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setTransfersInView(entry.isIntersecting),
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Desktop dual-phone cycling
  useEffect(() => {
    if (isMobile || !transfersInView) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setUrbanIdx((prev) => (prev + 1) % URBAN_TRANSFER_SHOTS.length);
      setRailIdx((prev) => (prev + 1) % RAIL_TRANSFER_SHOTS.length);
    }, 4600);
    return () => window.clearInterval(timer);
  }, [isMobile, transfersInView]);

  const handleStoryTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleStoryTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;

    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      goStory(dx < 0 ? storyBeat + 1 : storyBeat - 1);
    }
  };

  const activeChapter = chapters[storyBeat] ?? chapters[0];

  return (
    <div className="release-showcase">
      {/* Akt II: przypięta opowieść produktowa na desktopie i scrollowana historia IG na mobile */}
      <section
        className="release-section story-section"
        id="trasa"
        aria-labelledby="story-title"
        ref={storySectionRef}
      >
        <div className="release-inner">
          <div className="release-head release-head-center">
            <h2 className="release-title" id="story-title">
              {copy.story.title}
            </h2>
            <p className="release-lead">{copy.story.subtitle}</p>
          </div>

          <div className="story-grid" ref={storyRef}>
            {!isMobile ? (
              <>
                {/* Desktop sticky split choreography */}
                <div className="story-beats" ref={storyBeatsRef} onMouseLeave={cancelBeatHover}>
                  <span
                    className="story-beat-indicator"
                    ref={storyIndicatorRef}
                    aria-hidden="true"
                  />
                  {copy.story.chapters.map((chapter, idx) => (
                    <article
                      key={chapter.id}
                      data-story-beat={idx}
                      className={
                        idx === storyBeat
                          ? 'story-beat is-active'
                          : idx === pendingBeat
                            ? 'story-beat is-pending'
                            : 'story-beat'
                      }
                      onMouseEnter={() => startBeatHover(idx)}
                    >
                      <button
                        type="button"
                        className="story-beat-hit"
                        aria-label={chapter.title}
                        aria-current={idx === storyBeat ? 'true' : undefined}
                        onClick={() => selectBeat(idx)}
                      />
                      <div className="story-beat-meta">
                        <span className="story-beat-num">{chapter.number}</span>
                      </div>
                      <h3 className="story-beat-title">{chapter.title}</h3>
                      <p className="story-beat-body">{chapter.body}</p>
                    </article>
                  ))}
                </div>

                <div className="story-sticky-col" aria-live="polite">
                  <div className="story-sticky-frame">
                    <div className="story-sticky-glow" aria-hidden="true" />
                    <Phone label={activeChapter.alt} statusTime={activeChapter.statusTime}>
                      <div className="pixel-slide-stack">
                        {copy.story.chapters.map((chapter, idx) => (
                          <img
                            key={chapter.id}
                            className={
                              idx === storyBeat
                                ? 'pixel-slide pixel-shot is-active'
                                : 'pixel-slide pixel-shot'
                            }
                            src={chapter.shot}
                            alt={idx === storyBeat ? chapter.alt : ''}
                            width="720"
                            height="1600"
                            loading="lazy"
                            decoding="async"
                          />
                        ))}
                      </div>
                    </Phone>
                    <div className="story-progress-rails" aria-hidden="true">
                      {copy.story.chapters.map((chapter, idx) => (
                        <span
                          key={chapter.id}
                          className={
                            idx === storyBeat ? 'story-rail-dot is-active' : 'story-rail-dot'
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Mobile full-height Instagram Stories view */
              <div
                className={immersive ? 'story-ig is-immersive' : 'story-ig'}
                ref={storyIgRef}
                onTouchStart={handleStoryTouchStart}
                onTouchEnd={handleStoryTouchEnd}
              >
                <div className="story-ig-top">
                  <div className="story-ig-bars" role="tablist" aria-label={copy.story.title}>
                    {chapters.map((chapter, idx) => (
                      <button
                        key={chapter.id}
                        type="button"
                        role="tab"
                        aria-selected={idx === storyBeat}
                        aria-label={`${chapter.number} ${chapter.tag}`}
                        className="story-ig-bar-btn"
                        onClick={() => goStory(idx)}
                      >
                        <span className="story-ig-bar-track">
                          <span
                            key={idx === storyBeat ? `${chapter.id}-active` : chapter.id}
                            onAnimationEnd={idx === storyBeat ? handleStoryFillEnd : undefined}
                            className={
                              idx < storyBeat
                                ? 'story-ig-bar-fill is-done'
                                : idx === storyBeat
                                  ? 'story-ig-bar-fill is-active'
                                  : 'story-ig-bar-fill'
                            }
                          />
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="story-ig-header">
                    <div className="story-ig-identity">
                      <img
                        className="story-ig-avatar"
                        src="./icon.png"
                        alt=""
                        width="28"
                        height="28"
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="story-ig-tag">{activeChapter.tag}</span>
                    </div>

                    <div className="story-ig-nav">
                      <button
                        type="button"
                        className="story-ig-nav-btn"
                        aria-label={chapters[(storyBeat - 1 + storyCount) % storyCount].tag}
                        onClick={() => goStory(storyBeat - 1)}
                      >
                        <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="story-ig-nav-btn"
                        aria-label={chapters[(storyBeat + 1) % storyCount].tag}
                        onClick={() => goStory(storyBeat + 1)}
                      >
                        <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="story-ig-stage">
                  <div className="story-ig-glow" aria-hidden="true" />
                  <div className="story-ig-phone-wrap">
                    <Phone label={activeChapter.alt} statusTime={activeChapter.statusTime}>
                      <div className="pixel-slide-stack">
                        {chapters.map((chapter, idx) => (
                          <img
                            key={chapter.id}
                            className={
                              idx === storyBeat
                                ? 'pixel-slide pixel-shot is-active'
                                : 'pixel-slide pixel-shot'
                            }
                            src={chapter.shot}
                            alt={idx === storyBeat ? chapter.alt : ''}
                            width="720"
                            height="1600"
                            loading="lazy"
                            decoding="async"
                          />
                        ))}
                      </div>
                    </Phone>
                  </div>

                  {/* Instagram-style invisible left/right tap zones */}
                  <button
                    type="button"
                    className="story-ig-tap story-ig-tap-prev"
                    aria-label={chapters[(storyBeat - 1 + storyCount) % storyCount].tag}
                    onClick={() => goStory(storyBeat - 1)}
                  />
                  <button
                    type="button"
                    className="story-ig-tap story-ig-tap-next"
                    aria-label={chapters[(storyBeat + 1) % storyCount].tag}
                    onClick={() => goStory(storyBeat + 1)}
                  />
                </div>

                <div className="story-ig-caption" aria-live="polite">
                  <div key={activeChapter.id} className="story-ig-caption-inner">
                    <h3 className="story-ig-title">{activeChapter.title}</h3>
                    <p className="story-ig-body">{activeChapter.body}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ACT III: Transfer Protection & Nationwide Rail */}
      {!isMobile && (
        <section
          className="release-section transfers-section"
          id="przesiadki"
          ref={transfersRef}
          aria-labelledby="transfers-title"
        >
          <div className="release-inner">
            <div className="release-head release-head-center">
              <h2 className="release-title" id="transfers-title">
                {copy.transfers.title}
              </h2>
              <p className="release-lead">{copy.transfers.body}</p>
            </div>

            <div className="transfer-stage">
              {/* Desktop side-by-side dual stage */}
              <article className="transfer-column transfer-desktop-col">
                <div className="transfer-phone-wrap">
                  <Phone label={copy.transfers.urbanAlts[urbanIdx]} statusTime="09:07">
                    <div className="pixel-slide-stack">
                      {URBAN_TRANSFER_SHOTS.map((src, idx) => (
                        <img
                          key={src}
                          className={
                            idx === urbanIdx
                              ? 'pixel-slide pixel-shot is-active'
                              : 'pixel-slide pixel-shot'
                          }
                          src={src}
                          alt={idx === urbanIdx ? copy.transfers.urbanAlts[idx] : ''}
                          width="720"
                          height="1600"
                          loading="lazy"
                          decoding="async"
                        />
                      ))}
                    </div>
                  </Phone>
                </div>
                <div className="transfer-beat-bar" aria-hidden="true">
                  {URBAN_TRANSFER_SHOTS.map((src, idx) => (
                    <span
                      key={src}
                      className={
                        idx === urbanIdx ? 'transfer-bar-seg is-active' : 'transfer-bar-seg'
                      }
                    />
                  ))}
                </div>
                <div className="transfer-text">
                  <h3>{copy.transfers.urbanTitle}</h3>
                  <p>{copy.transfers.urbanBody}</p>
                </div>
              </article>

              <article className="transfer-column transfer-desktop-col">
                <div className="transfer-phone-wrap">
                  <Phone
                    label={copy.transfers.railAlts[railIdx]}
                    statusTime={railIdx === 1 ? '09:32' : '09:07'}
                  >
                    <div className="pixel-slide-stack">
                      {RAIL_TRANSFER_SHOTS.map((src, idx) => (
                        <img
                          key={src}
                          className={
                            idx === railIdx
                              ? 'pixel-slide pixel-shot is-active'
                              : 'pixel-slide pixel-shot'
                          }
                          src={src}
                          alt={idx === railIdx ? copy.transfers.railAlts[idx] : ''}
                          width="720"
                          height="1600"
                          loading="lazy"
                          decoding="async"
                        />
                      ))}
                    </div>
                  </Phone>
                </div>
                <div className="transfer-beat-bar" aria-hidden="true">
                  {RAIL_TRANSFER_SHOTS.map((src, idx) => (
                    <span
                      key={src}
                      className={
                        idx === railIdx ? 'transfer-bar-seg is-active' : 'transfer-bar-seg'
                      }
                    />
                  ))}
                </div>
                <div className="transfer-text">
                  <h3>{copy.transfers.railTitle}</h3>
                  <p>{copy.transfers.railBody}</p>
                </div>
              </article>
            </div>
          </div>
        </section>
      )}

      {/* ACT IV: Disruptions & Material You craft */}
      {!isMobile && (
        <section
          className="release-section disruptions-section"
          id="utrudnienia"
          aria-labelledby="disruptions-title"
        >
          <div className="release-inner">
            <div className="disruptions-grid">
              <div className="disruptions-copy">
                <h2 className="release-title" id="disruptions-title">
                  {copy.disruptions.title}
                </h2>
                <p className="release-lead">{copy.disruptions.body}</p>
              </div>

              <div className="disruptions-phone">
                <Phone label={copy.disruptions.phoneAlt} statusTime="09:26">
                  <img
                    className="pixel-shot"
                    src={DISRUPTIONS_SHOT}
                    alt={copy.disruptions.phoneAlt}
                    width="720"
                    height="1600"
                    loading="lazy"
                    decoding="async"
                  />
                </Phone>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
