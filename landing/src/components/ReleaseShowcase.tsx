import { useCallback, useEffect, useRef, useState } from 'react';
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

type CombinedTransferFrame = {
  src: string;
  group: 'urban' | 'rail';
  groupIdx: number;
  statusTime: string;
};

const COMBINED_TRANSFER_FRAMES: readonly CombinedTransferFrame[] = [
  { src: URBAN_TRANSFER_SHOTS[0], group: 'urban', groupIdx: 0, statusTime: '09:07' },
  { src: URBAN_TRANSFER_SHOTS[1], group: 'urban', groupIdx: 1, statusTime: '09:07' },
  { src: RAIL_TRANSFER_SHOTS[0], group: 'rail', groupIdx: 0, statusTime: '09:07' },
  { src: RAIL_TRANSFER_SHOTS[1], group: 'rail', groupIdx: 1, statusTime: '09:32' },
  { src: RAIL_TRANSFER_SHOTS[2], group: 'rail', groupIdx: 2, statusTime: '09:07' },
];

const STORY_DURATION_MS = 5600;
const MOBILE_TRANSFER_DURATION_MS = 3800;

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

  // Act II: scroll-driven sticky choreography on desktop, full-height IG Stories on mobile
  const storyRef = useRef<HTMLDivElement>(null);
  const storyIgRef = useRef<HTMLDivElement>(null);
  const [storyBeat, setStoryBeat] = useState(0);
  const [storyResetTick, setStoryResetTick] = useState(0);
  const [storyInView, setStoryInView] = useState(false);
  const [storyPaused, setStoryPaused] = useState(false);

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const holdTimerRef = useRef<number | undefined>(undefined);
  const wasHeldRef = useRef(false);

  // Act III: ambient cycling on desktop (2 phones) + unified single-phone sequence on mobile
  const transfersRef = useRef<HTMLElement>(null);
  const [transfersInView, setTransfersInView] = useState(false);
  const [urbanIdx, setUrbanIdx] = useState(0);
  const [railIdx, setRailIdx] = useState(0);
  const [mobileTransferIdx, setMobileTransferIdx] = useState(0);

  const storyCount = copy.story.chapters.length;

  const goStory = useCallback(
    (nextIndex: number) => {
      const wrapped = ((nextIndex % storyCount) + storyCount) % storyCount;
      setStoryBeat(wrapped);
      setStoryResetTick((t) => t + 1);
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

  // Mobile-only viewport observer for IG Stories auto-advance
  useEffect(() => {
    if (!isMobile) {
      setStoryInView(false);
      return;
    }
    const el = storyIgRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setStoryInView(entry.isIntersecting),
      { threshold: 0.35 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isMobile]);

  // Mobile IG Stories timer (auto-advances and loops cleanly while visible and unpaused)
  useEffect(() => {
    if (!isMobile || !storyInView || storyPaused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setTimeout(() => {
      setStoryBeat((prev) => (prev + 1) % storyCount);
      setStoryResetTick((t) => t + 1);
    }, STORY_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [isMobile, storyInView, storyPaused, storyBeat, storyResetTick, storyCount]);

  // Cleanup hold timer on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== undefined) {
        window.clearTimeout(holdTimerRef.current);
      }
    };
  }, []);

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

  // Mobile unified single-mock cycling across Urban -> Rail -> Urban seamlessly
  useEffect(() => {
    if (!isMobile || !transfersInView) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setTimeout(() => {
      setMobileTransferIdx((prev) => (prev + 1) % COMBINED_TRANSFER_FRAMES.length);
    }, MOBILE_TRANSFER_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [isMobile, transfersInView, mobileTransferIdx]);

  const handleStoryTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    wasHeldRef.current = false;
    if (holdTimerRef.current !== undefined) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      wasHeldRef.current = true;
      setStoryPaused(true);
    }, 200);
  };

  const handleStoryTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start || e.touches.length !== 1) return;
    const dx = Math.abs(e.touches[0].clientX - start.x);
    const dy = Math.abs(e.touches[0].clientY - start.y);
    if (dx > 10 || dy > 10) {
      if (holdTimerRef.current !== undefined) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = undefined;
      }
      setStoryPaused(false);
    }
  };

  const handleStoryTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (holdTimerRef.current !== undefined) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = undefined;
    }
    if (storyPaused) setStoryPaused(false);

    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || wasHeldRef.current) return;

    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;

    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      goStory(dx < 0 ? storyBeat + 1 : storyBeat - 1);
    }
  };

  const activeChapter = copy.story.chapters[storyBeat] ?? copy.story.chapters[0];
  const activeMobileTransfer =
    COMBINED_TRANSFER_FRAMES[mobileTransferIdx] ?? COMBINED_TRANSFER_FRAMES[0];
  const activeMobileGroup = activeMobileTransfer.group;
  const activeMobileAlt =
    activeMobileGroup === 'urban'
      ? copy.transfers.urbanAlts[activeMobileTransfer.groupIdx]
      : copy.transfers.railAlts[activeMobileTransfer.groupIdx];

  return (
    <div className="release-showcase">
      {/* ACT II: Scroll-choreographed 3-beat product story (desktop) / Full-height IG Stories (mobile) */}
      <section className="release-section story-section" id="trasa" aria-labelledby="story-title">
        <div className="release-inner">
          <div className="release-head release-head-center">
            <h2 className="release-title" id="story-title">
              {copy.story.title}
            </h2>
            <p className="release-lead">{copy.story.subtitle}</p>
          </div>

          <div className="story-grid" ref={storyRef}>
            {/* Desktop sticky split choreography */}
            <div className="story-beats">
              {copy.story.chapters.map((chapter, idx) => (
                <article
                  key={chapter.id}
                  data-story-beat={idx}
                  className={idx === storyBeat ? 'story-beat is-active' : 'story-beat'}
                >
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
                        loading={idx === 0 ? 'eager' : 'lazy'}
                        decoding="async"
                      />
                    ))}
                  </div>
                </Phone>
                <div className="story-progress-rails" aria-hidden="true">
                  {copy.story.chapters.map((chapter, idx) => (
                    <span
                      key={chapter.id}
                      className={idx === storyBeat ? 'story-rail-dot is-active' : 'story-rail-dot'}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Mobile full-height Instagram Stories view */}
            <div
              className={`story-ig${storyPaused ? ' is-paused' : ''}${storyInView ? ' is-in-view' : ''}`}
              ref={storyIgRef}
              onTouchStart={handleStoryTouchStart}
              onTouchMove={handleStoryTouchMove}
              onTouchEnd={handleStoryTouchEnd}
              onTouchCancel={() => {
                if (holdTimerRef.current !== undefined) {
                  window.clearTimeout(holdTimerRef.current);
                  holdTimerRef.current = undefined;
                }
                setStoryPaused(false);
              }}
            >
              <div className="story-ig-top">
                <div className="story-ig-bars" role="tablist" aria-label={copy.story.title}>
                  {copy.story.chapters.map((chapter, idx) => (
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
                          key={idx === storyBeat ? `${chapter.id}-${storyResetTick}` : chapter.id}
                          className={
                            idx < storyBeat
                              ? 'story-ig-bar-fill is-done'
                              : idx === storyBeat
                                ? 'story-ig-bar-fill is-active'
                                : 'story-ig-bar-fill'
                          }
                          style={
                            idx === storyBeat
                              ? { animationDuration: `${STORY_DURATION_MS}ms` }
                              : undefined
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
                    />
                    <span className="story-ig-tag">{activeChapter.tag}</span>
                    <span className="story-ig-step">
                      {activeChapter.number} / 0{storyCount}
                    </span>
                  </div>

                  <div className="story-ig-nav">
                    <button
                      type="button"
                      className="story-ig-nav-btn"
                      aria-label={copy.story.chapters[(storyBeat - 1 + storyCount) % storyCount].tag}
                      onClick={() => goStory(storyBeat - 1)}
                    >
                      <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="story-ig-nav-btn"
                      aria-label={copy.story.chapters[(storyBeat + 1) % storyCount].tag}
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
                          loading={idx === 0 ? 'eager' : 'lazy'}
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
                  aria-label={copy.story.chapters[(storyBeat - 1 + storyCount) % storyCount].tag}
                  onClick={() => {
                    if (!wasHeldRef.current) goStory(storyBeat - 1);
                  }}
                />
                <button
                  type="button"
                  className="story-ig-tap story-ig-tap-next"
                  aria-label={copy.story.chapters[(storyBeat + 1) % storyCount].tag}
                  onClick={() => {
                    if (!wasHeldRef.current) goStory(storyBeat + 1);
                  }}
                />
              </div>

              <div className="story-ig-caption" aria-live="polite">
                <div key={activeChapter.id} className="story-ig-caption-inner">
                  <h3 className="story-ig-title">{activeChapter.title}</h3>
                  <p className="story-ig-body">{activeChapter.body}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ACT III: Transfer Protection & Nationwide Rail */}
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
                    className={idx === urbanIdx ? 'transfer-bar-seg is-active' : 'transfer-bar-seg'}
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
                    className={idx === railIdx ? 'transfer-bar-seg is-active' : 'transfer-bar-seg'}
                  />
                ))}
              </div>
              <div className="transfer-text">
                <h3>{copy.transfers.railTitle}</h3>
                <p>{copy.transfers.railBody}</p>
              </div>
            </article>

            {/* Mobile unified single-mock stage seamlessly combining urban & rail animations */}
            <article className="transfer-column transfer-mobile-unified">
              <div className="transfer-mode-switch" role="tablist" aria-label={copy.transfers.title}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeMobileGroup === 'urban'}
                  className={
                    activeMobileGroup === 'urban'
                      ? 'transfer-mode-pill is-active'
                      : 'transfer-mode-pill'
                  }
                  onClick={() => setMobileTransferIdx(0)}
                >
                  {copy.transfers.urbanLabel}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeMobileGroup === 'rail'}
                  className={
                    activeMobileGroup === 'rail'
                      ? 'transfer-mode-pill is-active'
                      : 'transfer-mode-pill'
                  }
                  onClick={() => setMobileTransferIdx(URBAN_TRANSFER_SHOTS.length)}
                >
                  {copy.transfers.railLabel}
                </button>
              </div>

              <div className="transfer-phone-wrap">
                <Phone label={activeMobileAlt} statusTime={activeMobileTransfer.statusTime}>
                  <div className="pixel-slide-stack">
                    {COMBINED_TRANSFER_FRAMES.map((frame, idx) => (
                      <img
                        key={frame.src}
                        className={
                          idx === mobileTransferIdx
                            ? 'pixel-slide pixel-shot is-active'
                            : 'pixel-slide pixel-shot'
                        }
                        src={frame.src}
                        alt={idx === mobileTransferIdx ? activeMobileAlt : ''}
                        width="720"
                        height="1600"
                        loading="lazy"
                        decoding="async"
                      />
                    ))}
                  </div>
                </Phone>
              </div>

              <div className="transfer-beat-bar transfer-beat-bar-unified" aria-hidden="true">
                {COMBINED_TRANSFER_FRAMES.map((frame, idx) => (
                  <span
                    key={frame.src}
                    className={
                      idx === mobileTransferIdx
                        ? 'transfer-bar-seg is-active'
                        : frame.group === activeMobileGroup
                          ? 'transfer-bar-seg is-group'
                          : 'transfer-bar-seg'
                    }
                  />
                ))}
              </div>

              <div className="transfer-text transfer-text-crossfade">
                <div
                  className={
                    activeMobileGroup === 'urban'
                      ? 'transfer-text-pane is-active'
                      : 'transfer-text-pane'
                  }
                  aria-hidden={activeMobileGroup !== 'urban'}
                >
                  <h3>{copy.transfers.urbanTitle}</h3>
                  <p>{copy.transfers.urbanBody}</p>
                </div>

                <div
                  className={
                    activeMobileGroup === 'rail'
                      ? 'transfer-text-pane is-active'
                      : 'transfer-text-pane'
                  }
                  aria-hidden={activeMobileGroup !== 'rail'}
                >
                  <h3>{copy.transfers.railTitle}</h3>
                  <p>{copy.transfers.railBody}</p>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ACT IV: Disruptions & Material You craft */}
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
                  src="./screenshots/news-disruptions.webp"
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
    </div>
  );
}
