import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  BusFront,
  CableCar,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Footprints,
  Link,
  MessageCircle,
  Share2,
  TrainFront,
  TramFront,
} from 'lucide-react';
import {
  decodeSharedConnection,
  formatShareTime,
  shareMessage,
  transferCount,
  encodeSharedConnection,
  type SharedLeg,
} from '../../../src/sharing/connection';
import type { StaticStop } from '../../../src/sharing/timetable';
import {
  scheduledVehiclePosition,
  sharedJourneySeconds,
  sharedLegStops,
} from '../../../src/sharing/progress';
import { getLineColors } from '../../../src/services/lineIdentity';
import { useShareStrings, useWebLocale } from '../i18n';
import { loadSharedStops } from '../sharedTimetable';
import './sharedJourney.css';

function lineStyle(leg: SharedLeg, city: string): CSSProperties {
  if (leg.mode === 'walk') return {};
  const { bg, fg } = getLineColors(leg.line, leg.mode, city);
  return { '--leg-accent': bg, '--leg-on-accent': fg } as CSSProperties;
}

function Vehicle({ mode }: { mode: SharedLeg['mode'] }) {
  const Icon =
    mode === 'walk'
      ? Footprints
      : mode === 'tram'
        ? TramFront
        : mode === 'train' || mode === 'subway'
          ? TrainFront
          : mode === 'cable'
            ? CableCar
            : BusFront;
  return <Icon size={20} aria-hidden="true" />;
}

function StopTimeline({ leg, stops, now }: { leg: SharedLeg; stops: StaticStop[]; now: number }) {
  const s = useShareStrings();
  const position = leg.mode === 'walk' ? null : scheduledVehiclePosition(stops, now);
  const current = position ? stops[position.index] : null;
  const label =
    position && current
      ? position.fraction === 0
        ? s.vehicleAt(s.modes[leg.mode], current.name)
        : s.vehicleBetween(s.modes[leg.mode], current.name, stops[position.index + 1].name)
      : '';

  return (
    <>
      {position && <p className="journey-position-label">{s.estimatedPosition}</p>}
      <ol className="journey-stop-list" aria-label={s.timetable}>
        {stops.map((stop, index) => {
          const seconds = index === stops.length - 1 ? stop.arrival : stop.departure;
          const endpoint = index === 0 || index === stops.length - 1;
          return (
            <li
              key={`${stop.id}-${index}`}
              className={`journey-stop${endpoint ? ' journey-stop-endpoint' : ''}${now > seconds ? ' journey-stop-passed' : ''}`}
            >
              <span className="journey-stop-rail" aria-hidden="true">
                <span className="journey-stop-dot" />
              </span>
              <span className="journey-stop-name">{stop.name}</span>
              <time>
                {formatShareTime(((Math.floor(seconds / 60) % 1440) + 1440) % 1440)}
                {seconds >= 86400 && <small>{s.dayLater(Math.floor(seconds / 86400))}</small>}
              </time>
              {position?.index === index && (
                <span
                  className="journey-vehicle"
                  style={{ top: `calc(0.75rem + ${position.fraction * 100}%)` }}
                  role="img"
                  aria-label={label}
                >
                  <Vehicle mode={leg.mode} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}

export default function SharedJourney({ hash }: { hash: string }) {
  const s = useShareStrings();
  const locale = useWebLocale();
  const journey = useMemo(
    () => decodeSharedConnection(new URLSearchParams(hash.slice(1)).get('trip') || ''),
    [hash],
  );
  const [stops, setStops] = useState<StaticStop[][]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!journey) return;
    const update = () => setNow(new Date());
    update();
    const timer = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [journey]);

  useEffect(() => {
    document.title = `${s.pageTitle} | ${s.brand}`;
  }, [s]);

  useEffect(() => {
    setStops([]);
    setFailed(false);
    setCopied(false);
    setLoading(false);
    if (!journey || journey.legs.every((leg) => leg.mode === 'walk')) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    setLoading(true);
    void loadSharedStops(journey, controller.signal)
      .then((result) => {
        if (active && !controller.signal.aborted) {
          setStops(result);
          setFailed(journey.legs.some((leg, i) => leg.mode !== 'walk' && result[i].length === 0));
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [journey, retry]);

  if (!journey)
    return (
      <main id="main" className="shared-journey shared-empty">
        <Link size={36} aria-hidden="true" />
        <h1>{s.invalidTitle}</h1>
        <p>{s.invalidBody}</p>
        <a className="journey-button" href="#top">
          {s.home}
        </a>
      </main>
    );

  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${journey.date}T12:00:00Z`));
  const arrivalDay = Math.floor(journey.arrival / 1440);
  const elapsed = sharedJourneySeconds(journey.date, now);
  const url = window.location.href;
  const message = shareMessage(journey, s);
  const smsUrl = `sms:${/iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(`${message}\n${url}`)}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setShareError(false);
    } catch {
      setShareError(true);
    }
  }

  async function share() {
    try {
      setShareError(false);
      if (navigator.share) await navigator.share({ title: s.pageTitle, text: message, url });
      else await copyLink();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setShareError(true);
    }
  }

  return (
    <main id="main" className="shared-journey">
      <div className="journey-heading">
        <h1>{s.pageTitle}</h1>
        <p>{date}</p>
        <a
          className="journey-button"
          href={`kilometr://shared?trip=${encodeSharedConnection(journey)}`}
        >
          {s.openApp}
        </a>
        <p>{s.appHint}</p>
      </div>
      <div className="journey-layout">
        <aside
          className="journey-overview"
          aria-label={s.cardLabel(journey.from, journey.to, formatShareTime(journey.arrival))}
        >
          <div className="journey-ticket">
            <div className="journey-endpoints">
              <div>
                <p>{s.departure}</p>
                <div className="journey-time">{formatShareTime(journey.departure)}</div>
                <h2>{journey.from}</h2>
              </div>
              <ArrowRight className="journey-route-arrow" size={24} aria-hidden="true" />
              <div>
                <p>{s.arrival}</p>
                <div className="journey-time">
                  {formatShareTime(journey.arrival)}
                  {arrivalDay > 0 && <span>{s.dayLater(arrivalDay)}</span>}
                </div>
                <h2>{journey.to}</h2>
              </div>
            </div>
            <div className="journey-ticket-body">
              <div className="journey-facts">
                <strong>
                  <Clock3 size={20} aria-hidden="true" />
                  {s.duration(journey.arrival - journey.departure)}
                </strong>
                <span>
                  {journey.legs.every((leg) => leg.mode === 'walk')
                    ? s.walk
                    : s.transfers(transferCount(journey))}
                </span>
              </div>
              <div className="journey-services">
                {journey.legs.map((leg, i) => (
                  <span
                    key={i}
                    className="journey-service"
                    data-mode={leg.mode}
                    style={lineStyle(leg, journey.city)}
                    aria-label={`${s.modes[leg.mode]} ${leg.line || ''}`}
                  >
                    <Vehicle mode={leg.mode} />
                    {leg.line || (leg.mode === 'walk' ? s.walk : s.modes[leg.mode])}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p className="journey-note">
            {s.snapshot}
            {journey.legs.some((leg) => leg.mode !== 'walk') && <> {s.positionNote}</>}
          </p>
          <div className="journey-actions">
            <button type="button" className="journey-button" onClick={() => void share()}>
              <Share2 size={20} aria-hidden="true" />
              {s.linkOnly}
            </button>
            <button
              type="button"
              className="journey-button journey-button-tonal"
              onClick={() => void copyLink()}
            >
              {copied ? (
                <Check size={20} aria-hidden="true" />
              ) : (
                <Copy size={20} aria-hidden="true" />
              )}
              <span aria-live="polite">{copied ? s.copied : s.copy}</span>
            </button>
            <a className="journey-sms journey-button-tonal" href={smsUrl}>
              <MessageCircle size={20} aria-hidden="true" />
              {s.sms}
            </a>
          </div>
          {shareError && (
            <p className="journey-error" role="alert">
              {s.error}
            </p>
          )}
        </aside>
        <section className="journey-itinerary" aria-labelledby="itinerary-title">
          <h2 id="itinerary-title">{s.itinerary}</h2>
          <ol className="journey-legs">
            {journey.legs.map((leg, i) => (
              <li
                key={i}
                className={`journey-leg${leg.mode === 'walk' ? ' journey-leg-walk' : ''}`}
                data-mode={leg.mode}
                style={lineStyle(leg, journey.city)}
              >
                <div className="journey-leg-heading">
                  <span className="journey-leg-icon">
                    <Vehicle mode={leg.mode} />
                    {leg.line && <strong>{leg.line}</strong>}
                  </span>
                  <div>
                    <h3>{leg.direction || s.modes[leg.mode]}</h3>
                    {leg.mode !== 'walk' && <p>{s.modes[leg.mode]}</p>}
                    {leg.mode === 'walk' && leg.walk != null && <p>{s.walkDistance(leg.walk)}</p>}
                  </div>
                  <span className="journey-leg-duration">
                    {s.duration(leg.arrival - leg.departure)}
                  </span>
                </div>
                {stops[i]?.length > 2 ? (
                  <>
                    <div className="journey-leg-summary">
                      <p>
                        <span>{s.from}</span> <strong>{leg.from}</strong>{' '}
                        <time>{formatShareTime(leg.departure)}</time>
                      </p>
                      <p>
                        <span>{s.to}</span> <strong>{leg.to}</strong>{' '}
                        <time>
                          {formatShareTime(leg.arrival)}
                          {leg.arrival >= 1440 && (
                            <> {s.dayLater(Math.floor(leg.arrival / 1440))}</>
                          )}
                        </time>
                      </p>
                    </div>
                    <details className="journey-stops" open>
                      <summary>
                        <span className="journey-show-stops">{s.showStops(stops[i].length)}</span>
                        <span className="journey-hide-stops">{s.hideStops}</span>
                        <ChevronDown size={18} aria-hidden="true" />
                      </summary>
                      <StopTimeline leg={leg} stops={sharedLegStops(leg, stops[i])} now={elapsed} />
                    </details>
                  </>
                ) : (
                  <StopTimeline leg={leg} stops={sharedLegStops(leg, stops[i])} now={elapsed} />
                )}
              </li>
            ))}
          </ol>
          <div aria-live="polite" className="journey-data-state">
            {loading && <p role="status">{s.loading}</p>}
            {!loading && failed && (
              <>
                <p>{s.stopsUnavailable}</p>
                <button
                  type="button"
                  className="journey-retry"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  {s.retry}
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
