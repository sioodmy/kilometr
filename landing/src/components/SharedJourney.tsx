import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  BusFront,
  CableCar,
  Check,
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
  type SharedLeg,
} from '../../../src/sharing/connection';
import type { StaticStop } from '../../../src/sharing/timetable';
import { useShareStrings, useWebLocale } from '../i18n';
import { loadSharedStops } from '../sharedTimetable';
import './sharedJourney.css';

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
      </div>
      <div className="journey-layout">
        <aside
          className="journey-overview"
          aria-label={s.cardLabel(journey.from, journey.to, formatShareTime(journey.arrival))}
        >
          <div className="journey-ticket">
            <div className="journey-arrival">
              <p>{s.arrival}</p>
              <div className="journey-time">
                {formatShareTime(journey.arrival)}
                {arrivalDay > 0 && <span>{s.dayLater(arrivalDay)}</span>}
              </div>
              <h2>{journey.to}</h2>
            </div>
            <div className="journey-ticket-body">
              <div className="journey-origin">
                <div>
                  <p>
                    {s.departure} · {formatShareTime(journey.departure)}
                  </p>
                  <h3>{journey.from}</h3>
                </div>
                <ArrowRight size={24} aria-hidden="true" />
              </div>
              <div className="journey-facts">
                <strong>{s.duration(journey.arrival - journey.departure)}</strong>
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
                    aria-label={`${s.modes[leg.mode]} ${leg.line || ''}`}
                  >
                    <Vehicle mode={leg.mode} />
                    {leg.line || (leg.mode === 'walk' ? s.walk : s.modes[leg.mode])}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p className="journey-note">{s.snapshot}</p>
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
              >
                <div className="journey-leg-heading">
                  <span className="journey-leg-icon">
                    <Vehicle mode={leg.mode} />
                  </span>
                  <div>
                    <h3>
                      {s.modes[leg.mode]}
                      {leg.line ? ` ${leg.line}` : ''}
                    </h3>
                    {leg.direction && <p>{s.direction(leg.direction)}</p>}
                    {leg.mode === 'walk' && leg.walk != null && <p>{s.walkDistance(leg.walk)}</p>}
                  </div>
                </div>
                <div className="journey-leg-endpoint">
                  <time>{formatShareTime(leg.departure)}</time>
                  <span>{leg.from}</span>
                </div>
                <div className="journey-leg-path">
                  <ArrowDown size={16} aria-hidden="true" />
                  <span>{s.duration(leg.arrival - leg.departure)}</span>
                </div>
                <div className="journey-leg-endpoint">
                  <time>
                    {formatShareTime(leg.arrival)}
                    {leg.arrival >= 1440 && (
                      <small>{s.dayLater(Math.floor(leg.arrival / 1440))}</small>
                    )}
                  </time>
                  <span>{leg.to}</span>
                </div>
                {stops[i]?.length > 0 && (
                  <details className="journey-stops">
                    <summary>{s.showStops(stops[i].length)}</summary>
                    <p>{s.timetable}</p>
                    <ol>
                      {stops[i].map((stop, index) => (
                        <li key={index}>
                          <time>
                            {formatShareTime(
                              Math.floor(
                                (index === stops[i].length - 1 ? stop.arrival : stop.departure) /
                                  60,
                              ),
                            )}
                          </time>
                          <span>{stop.name}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
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
