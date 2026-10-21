import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, BusFront, ChevronDown, ChevronRight, Clock3, TramFront } from 'lucide-react';
import { getLineColors } from '../../../src/services/lineIdentity';
import { useStrings } from '../i18n';

const connections = [
  { departure: 3, duration: 26, walk: 3, lines: ['4', '10'] },
  { departure: 7, duration: 18, walk: 2, lines: ['10'] },
  { departure: 12, duration: 29, walk: 4, lines: ['146', '10'] },
];
const selected = connections[1];
const lineColors = getLineColors(selected.lines[0], 'tram', 'wroclaw');
const legStyle: CSSProperties & { '--leg-accent': string } = { '--leg-accent': lineColors.bg };

function timeAt(now: number, minutes: number) {
  const date = new Date(now + minutes * 60_000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function WalkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7" />
    </svg>
  );
}

function LineBadge({ line }: { line: string }) {
  const colors = getLineColors(line, undefined, 'wroclaw');
  const Icon = colors.isTram ? TramFront : BusFront;
  return (
    <span className="demo-line-badge" style={{ background: colors.bg, color: colors.fg }}>
      <Icon size={13} aria-hidden="true" />
      <span>{line}</span>
    </span>
  );
}

/** Odtwarza ConnectionCard z RN, bez zależności od natywnych usług. */
function ConnectionCard({
  connection,
  now,
}: {
  connection: (typeof connections)[number];
  now: number;
}) {
  const s = useStrings().journeyDemo;
  return (
    <div className="demo-native-connection">
      <div className="demo-schedule">
        <span className="demo-departure">{s.departIn(connection.departure)}</span>
        <span className="demo-duration">
          <Clock3 size={14} aria-hidden="true" />
          {s.duration(connection.duration)}
        </span>
      </div>
      <div className="demo-journey-meta">
        <span className="demo-time-range">
          <time>{timeAt(now, connection.departure)}</time>
          <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
          <time>{timeAt(now, connection.departure + connection.duration)}</time>
        </span>
        <span className="demo-transfer-text">{s.transfers(connection.lines.length - 1)}</span>
      </div>
      <div className="demo-strip">
        <span className="demo-walk">
          <WalkIcon />
          {s.duration(connection.walk)}
        </span>
        {connection.lines.map((line) => (
          <span className="demo-strip-cell" key={line}>
            <ChevronRight size={12} strokeWidth={1.8} aria-hidden="true" />
            <LineBadge line={line} />
          </span>
        ))}
        <ChevronRight size={12} strokeWidth={1.8} aria-hidden="true" />
        <span className="demo-walk">
          <WalkIcon />
          {s.duration(4)}
        </span>
      </div>
    </div>
  );
}

export function JourneyDemo() {
  const s = useStrings().journeyDemo;
  const { stops, direction } = s.route;
  const section = useRef<HTMLElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const ride = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now);
  const [expanded, setExpanded] = useState(true);
  const [visible, setVisible] = useState(false);
  const [rideVisible, setRideVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [vehicleGap, setVehicleGap] = useState(0);

  useEffect(() => {
    const root = section.current;
    const row = options.current;
    const detail = ride.current;
    if (!root || !row || !detail) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let inView = false;
    let detailInView = false;
    const update = () => {
      frame = 0;
      const bounds = row.getBoundingClientRect();
      const start = Math.max(100, (window.innerHeight - bounds.height) / 2);
      const progress = Math.max(
        0,
        Math.min(1, (start - bounds.top) / Math.max(240, window.innerHeight * 0.42)),
      );
      const exit = Math.min(1, progress / 0.8);
      const eased = exit * exit * (3 - 2 * exit);
      root.style.setProperty(
        '--choice-travel',
        `${eased * ((window.innerWidth + bounds.width) / 2 + 24)}px`,
      );
      const revealed = media.matches || progress >= 0.9;
      root.style.setProperty('--ride-opacity', revealed ? '1' : '0');
      root.style.setProperty('--ride-shift', revealed ? '0px' : '-56px');
      detail.style.visibility = revealed ? 'visible' : 'hidden';
      setRideVisible(detailInView && revealed && !document.hidden);
    };
    const schedule = () => {
      if (inView && !frame) frame = requestAnimationFrame(update);
    };
    const visibility = () => {
      setVisible(inView && !document.hidden);
      update();
    };
    const motion = () => {
      setReducedMotion(media.matches);
      update();
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === root) inView = entry.isIntersecting;
        else detailInView = entry.isIntersecting;
      }
      setVisible(inView && !document.hidden);
      update();
    });
    observer.observe(root);
    observer.observe(detail);
    const resize = new ResizeObserver(schedule);
    resize.observe(row);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', visibility);
    media.addEventListener('change', motion);
    motion();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', visibility);
      media.removeEventListener('change', motion);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [visible]);

  useEffect(() => {
    if (!rideVisible || !expanded || reducedMotion || vehicleGap >= stops.length - 2) return;
    const timer = window.setTimeout(() => setVehicleGap((gap) => gap + 1), 2800);
    return () => window.clearTimeout(timer);
  }, [rideVisible, expanded, reducedMotion, vehicleGap, stops.length]);

  return (
    <section className="journey-demo" id="mozliwosci" ref={section} aria-labelledby="choose-title">
      <div className="demo-choose section-shell">
        <h2 id="choose-title">{s.choose}</h2>
        <div className="demo-options" ref={options}>
          {connections.map((connection) => (
            <div className="demo-choice" key={connection.departure}>
              <ConnectionCard connection={connection} now={now} />
            </div>
          ))}
        </div>
      </div>
      <div className="demo-ride section-shell" ref={ride}>
        <h2>{s.ride}</h2>
        <div className="demo-native-leg" style={legStyle}>
          <button
            className="demo-leg-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls="demo-stops"
            aria-label={s.expandA11y(selected.lines[0], direction, expanded)}
            onClick={() => {
              if (!expanded) setVehicleGap(0);
              setExpanded((value) => !value);
            }}
          >
            <span className="demo-leg-top">
              <LineBadge line={selected.lines[0]} />
              <span className="demo-direction">{direction}</span>
              <ChevronDown className="demo-leg-chevron" size={18} aria-hidden="true" />
            </span>
            <span className="demo-stop-big">
              <span className="demo-stop-prefix">{s.fromPrefix}</span>
              {stops[0]} <time>{timeAt(now, selected.departure + selected.walk)}</time>
            </span>
            <span className="demo-stops-summary">{s.stopsSummary(stops.length, 12, expanded)}</span>
            <span className="demo-stop-big">
              <span className="demo-stop-prefix">{s.toPrefix}</span>
              {stops[stops.length - 1]}{' '}
              <time>{timeAt(now, selected.departure + selected.duration - 4)}</time>
            </span>
          </button>
          <div
            className="demo-stops-disclosure"
            id="demo-stops"
            inert={!expanded}
            data-expanded={expanded}
          >
            <div className="demo-stops-inner">
              <div className="demo-stops-track">
                <ol className="demo-stop-list">
                  {stops.map((stop, index) => (
                    <li
                      className="demo-stop-row"
                      data-passed={index <= vehicleGap}
                      data-connector-passed={index < vehicleGap}
                      key={stop}
                    >
                      <span className="demo-stop-rail" aria-hidden="true">
                        <span className="demo-stop-dot" />
                      </span>
                      <span
                        className={`demo-stop-name${index === 0 || index === stops.length - 1 ? ' demo-stop-strong' : ''}`}
                      >
                        {stop}
                      </span>
                    </li>
                  ))}
                </ol>
                <span
                  className="demo-vehicle"
                  style={{ transform: `translateY(${vehicleGap * 30}px)` }}
                  aria-hidden="true"
                >
                  <TramFront size={14} strokeWidth={2.4} />
                </span>
              </div>
            </div>
          </div>
        </div>
        <p className="demo-caption">{s.mock}</p>
      </div>
    </section>
  );
}
