import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  BusFront,
  CableCar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Copy,
  ExternalLink,
  Footprints,
  Link,
  MessageCircle,
  RefreshCw,
  Share2,
  Smartphone,
  TrainFront,
  TramFront,
} from 'lucide-react';
import { CITIES } from '../../../src/cities';
import {
  buildShareUrl,
  decodeSharedConnection,
  extractShareTripToken,
  formatShareTime,
  shareMessage,
  transferCount,
  type SharedLeg,
} from '../../../src/sharing/connection';
import type { RoutePoint } from '../../../src/sharing/geometry';
import type { StaticStop } from '../../../src/sharing/timetable';
import {
  scheduledVehiclePosition,
  sharedJourneySeconds,
  sharedLegStops,
} from '../../../src/sharing/progress';
import { resolveLineBadgeIdentity } from '../../../src/services/lineIdentity';
import { inferRailAgencyFromLine, railAgencyFullName } from '../../../src/services/railIdentity';
import { resolveRailStrokeColor } from '../../../src/theme/colorContrast';
import { getWebShareStrings } from '../../../src/i18n/webShare';
import { setWebLocale, useStrings, useWebLocale, type Locale } from '../i18n';
import {
  fetchSharedJourneyLive,
  isJourneyInLiveWindow,
  type SharedWebLegLive,
  type SharedWebLiveSnapshot,
} from '../sharedLive';
import { loadSharedTimetable } from '../sharedTimetable';
import { RailCarrierMark } from './kilometrUi';
import './sharedJourney.css';

const SharedJourneyMap = lazy(() => import('./SharedJourneyMap'));
const SURFACE_CARD_HEX = '#1B2120';

function useShareStrings() {
  const locale = useWebLocale();
  return getWebShareStrings(locale);
}

function clockLabel(seconds: number): { time: string; day: number } {
  return {
    time: formatShareTime(((Math.floor(seconds / 60) % 1440) + 1440) % 1440),
    day: Math.floor(seconds / 86400),
  };
}

function M3ArrowRight({ color }: { color: string }) {
  return (
    <svg width="38" height="24" viewBox="0 0 32 24" fill="none" aria-hidden="true">
      <path
        d="M4 12H26M19 5L26.5 12L19 19"
        stroke={color}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function M3ArrowDown({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4V19.5M6 14L12 20L18 14"
        stroke={color}
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VehicleIcon({
  mode,
  railAgency,
  size = 13,
  color,
}: {
  mode: SharedLeg['mode'];
  railAgency?: string;
  size?: number;
  color?: string;
}) {
  if (railAgency) {
    return <RailCarrierMark agency={railAgency} color={color ?? 'currentColor'} size={size} />;
  }
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
  return <Icon size={size} aria-hidden="true" />;
}

function LegLineBadge({
  leg,
  city,
  compact = false,
}: {
  leg: SharedLeg;
  city: string;
  compact?: boolean;
}) {
  const s = useShareStrings();
  const railAgency = leg.mode === 'train' ? inferRailAgencyFromLine(leg.line, city) : undefined;
  const { bg, fg, normalizedLine, railAgency: resolvedAgency } = resolveLineBadgeIdentity({
    mode: leg.mode,
    line: leg.line,
    compact,
    cityId: city,
    railAgencyOverride: railAgency,
  });

  if (leg.mode === 'walk') {
    return (
      <span
        className={`km-badge km-badge-walk${compact ? ' is-compact' : ''}`}
        aria-label={s.walk}
      >
        <Footprints size={compact ? 12 : 14} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className={`km-badge${compact ? ' is-compact' : ''}`}
      style={{ backgroundColor: bg, color: fg }}
      aria-label={`${s.modes[leg.mode]} ${normalizedLine || ''}`}
    >
      <VehicleIcon
        mode={leg.mode}
        railAgency={resolvedAgency}
        size={compact ? 12 : 14}
        color={fg}
      />
      <span>{normalizedLine || s.modes[leg.mode]}</span>
    </span>
  );
}

interface LegScheduleView {
  live: SharedWebLegLive | null;
  delayMin: number;
  arrDelayMin: number;
  departure: number;
  arrival: number;
  baseDep: number;
  baseArr: number;
}

function TransitLegCard({
  leg,
  city,
  sched,
  stops,
  elapsedSec,
}: {
  leg: SharedLeg;
  city: string;
  sched: LegScheduleView;
  stops: StaticStop[];
  elapsedSec: number;
}) {
  const s = useShareStrings();
  const [expanded, setExpanded] = useState(false);

  const railAgency = leg.mode === 'train' ? inferRailAgencyFromLine(leg.line, city) : undefined;
  const identity = resolveLineBadgeIdentity({
    mode: leg.mode,
    line: leg.line,
    cityId: city,
    railAgencyOverride: railAgency,
  });
  const railStroke = resolveRailStrokeColor(identity.bg, SURFACE_CARD_HEX);
  const agencySubtitle = leg.mode === 'train' ? railAgencyFullName(identity.railAgency) : undefined;

  const legLive = sched.live;
  const liveDelaySec =
    legLive && (legLive.status === 'live' || legLive.status === 'estimated') ? legLive.delaySec : 0;
  const effectiveNow = elapsedSec - liveDelaySec;
  const fullStops = useMemo(() => sharedLegStops(leg, stops), [leg, stops]);
  const position = scheduledVehiclePosition(fullStops, effectiveNow);

  const intermediate = fullStops.length > 2 ? fullStops.slice(1, -1) : [];
  const intermediateCount =
    fullStops.length > 2 ? intermediate.length : Math.max(0, (leg.stops ?? 0) - 1);
  const canExpand = intermediate.length > 0;
  const durationMin = Math.max(0, sched.arrival - sched.departure);

  const livePlatform = legLive?.platform ?? leg.platform;
  const liveTrack = legLive?.track ?? leg.track;
  const platformText = s.platformLabel(livePlatform, liveTrack);
  const typicalMin =
    legLive?.typicalDelaySec && legLive.typicalDelaySec >= 120
      ? Math.round(legLive.typicalDelaySec / 60)
      : 0;

  const isTrain = leg.mode === 'train';
  const arrDay = Math.floor(sched.arrival / 1440);

  return (
    <article
      className="km-leg-card"
      style={
        {
          '--leg-rail': railStroke,
          '--leg-bg': identity.bg,
          '--leg-fg': identity.fg,
        } as CSSProperties
      }
    >
      {/* Wiersz odjazdu */}
      <div className="km-grid-row">
        <div className="km-endpoint-time">
          <time className="km-time-strong">{formatShareTime(sched.departure)}</time>
          {sched.delayMin !== 0 && (
            <span className="km-time-strike">{formatShareTime(sched.baseDep)}</span>
          )}
        </div>

        <div className="km-rail-col" aria-hidden="true">
          <span className="km-node-start" style={{ borderColor: railStroke }} />
          <span className="km-spine-down" style={{ backgroundColor: railStroke }} />
        </div>

        <div className="km-departure-content">
          <h3 className="km-stop-endpoint-title">{leg.from}</h3>
          {platformText && <span className="km-platform-badge">{platformText}</span>}
        </div>
      </div>

      {/* Wiersz środka: karta linii, status live i przycisk rozwijania przystanków */}
      <div className="km-grid-row">
        <div className="km-duration-col">
          <span>{s.duration(durationMin)}</span>
        </div>

        <div className="km-rail-col" aria-hidden="true">
          <span className="km-spine-full" style={{ backgroundColor: railStroke }} />
        </div>

        <div className="km-body-content">
          <div className="km-line-box">
            <LegLineBadge leg={leg} city={city} />
            <div className="km-line-copy">
              <strong className="km-line-direction">{leg.direction || leg.to}</strong>
              <span className="km-line-sub">{agencySubtitle || s.modes[leg.mode]}</span>
            </div>
          </div>

          {legLive && (legLive.status === 'live' || legLive.status === 'estimated' || legLive.cancelled) && (
            <div className="km-live-banner">
              <span
                className={`km-delay-pill${
                  legLive.cancelled || sched.delayMin > 0
                    ? ' is-late'
                    : legLive.status === 'estimated' || sched.delayMin < 0
                      ? ' is-warn'
                      : ' is-ontime'
                }`}
              >
                {legLive.cancelled
                  ? s.cancelledService
                  : legLive.status === 'estimated' && sched.delayMin > 0
                    ? s.estimatedDelay(sched.delayMin)
                    : s.liveDelay(sched.delayMin)}
              </span>
              {legLive.nextStop ? (
                <span className="km-live-banner-meta">{s.nextStopLabel(legLive.nextStop)}</span>
              ) : typicalMin >= 2 && legLive.status !== 'live' ? (
                <span className="km-live-banner-meta">{s.typicalDelayNote(typicalMin)}</span>
              ) : null}
            </div>
          )}

          {canExpand ? (
            <button
              type="button"
              className={`km-stops-toggle${expanded ? ' is-open' : ''}`}
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
            >
              <span>{expanded ? s.hideStops : s.intermediateStops(intermediateCount)}</span>
              <ChevronDown size={17} aria-hidden="true" className="km-stops-chevron" />
            </button>
          ) : (
            <p className="km-direct-ride">
              {intermediateCount > 0 ? s.intermediateStops(intermediateCount) : s.directRide}
            </p>
          )}
        </div>
      </div>

      {/* Rozwijana tacka przystanków pośrednich wyrównana do wspólnej osi X szyny */}
      {canExpand && expanded && (
        <div className="km-tray-wrap">
          <div className="km-tray-card">
            <div className="km-tray-cap" aria-hidden="true">
              <span className="km-time-spacer" />
              <span className="km-rail-col">
                <span className="km-spine-full" style={{ backgroundColor: railStroke }} />
              </span>
              <span />
            </div>

            {position && (
              <p className="km-tray-note">
                {liveDelaySec !== 0 ? s.estimatedPositionLive : s.estimatedPosition}
              </p>
            )}

            <ol className="km-stop-rows" aria-label={s.timetable}>
              {intermediate.map((stop, idx) => {
                const fullIdx = idx + 1;
                const arr = clockLabel(stop.arrival + liveDelaySec);
                const dep = clockLabel(stop.departure + liveDelaySec);
                const dwellMin = Math.round((stop.departure - stop.arrival) / 60);
                const showDual = isTrain && Math.abs(stop.departure - stop.arrival) >= 60;
                const primarySec = stop.departure + liveDelaySec;
                const passed = elapsedSec > primarySec;
                const isVehicleAtStop =
                  position != null && position.index === fullIdx && position.fraction < 0.15;
                const isVehicleAfterStop =
                  position != null && position.index === fullIdx && position.fraction >= 0.15;
                const nextStopObj = fullStops[fullIdx + 1];

                return (
                  <li key={`${stop.id}-${fullIdx}`} className="km-stop-li">
                    <div className="km-stop-row">
                      <div className="km-stop-time-col">
                        {showDual ? (
                          <>
                            <span className={`km-stop-time-pri${passed ? ' is-passed' : ''}`}>
                              {arr.time}
                            </span>
                            <span className="km-stop-time-sec">{dep.time}</span>
                          </>
                        ) : (
                          <span className={`km-stop-time-single${passed ? ' is-passed' : ''}`}>
                            {dep.time}
                          </span>
                        )}
                      </div>

                      <div className="km-rail-col" aria-hidden="true">
                        <span
                          className="km-rail-half"
                          style={{
                            backgroundColor: passed ? 'var(--km-outline-variant)' : railStroke,
                          }}
                        />
                        {isVehicleAtStop ? (
                          <span
                            className="km-veh-squircle"
                            style={{ backgroundColor: identity.bg, color: identity.fg }}
                          >
                            <VehicleIcon
                              mode={leg.mode}
                              railAgency={identity.railAgency}
                              size={13}
                              color={identity.fg}
                            />
                          </span>
                        ) : passed ? (
                          <span className="km-dot-passed" />
                        ) : (
                          <span className="km-ring-upcoming" style={{ borderColor: railStroke }} />
                        )}
                        <span
                          className="km-rail-half"
                          style={{
                            backgroundColor:
                              passed && !isVehicleAtStop ? 'var(--km-outline-variant)' : railStroke,
                          }}
                        />
                      </div>

                      <div className="km-stop-copy">
                        <span
                          className={`km-stop-name${passed ? ' is-passed' : ''}${isVehicleAtStop ? ' is-active' : ''}`}
                        >
                          {stop.name}
                        </span>
                        {showDual && dwellMin >= 2 && (
                          <span className="km-stop-meta">{s.dwellMin(dwellMin)}</span>
                        )}
                      </div>
                    </div>

                    {isVehicleAfterStop && nextStopObj && (
                      <div className="km-in-transit-row">
                        <div className="km-time-spacer" />
                        <div className="km-rail-col" aria-hidden="true">
                          <span
                            className="km-rail-half"
                            style={{ backgroundColor: 'var(--km-outline-variant)' }}
                          />
                          <span
                            className="km-veh-squircle"
                            style={{ backgroundColor: identity.bg, color: identity.fg }}
                          >
                            <VehicleIcon
                              mode={leg.mode}
                              railAgency={identity.railAgency}
                              size={13}
                              color={identity.fg}
                            />
                          </span>
                          <span className="km-rail-half" style={{ backgroundColor: railStroke }} />
                        </div>
                        <div className="km-in-transit-copy">
                          <span className="km-in-transit-pill">
                            {s.nextStopLabel(nextStopObj.name)}
                          </span>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>

            <div className="km-tray-cap" aria-hidden="true">
              <span className="km-time-spacer" />
              <span className="km-rail-col">
                <span className="km-spine-full" style={{ backgroundColor: railStroke }} />
              </span>
              <span />
            </div>
          </div>

          <div className="km-tray-connector" aria-hidden="true">
            <span className="km-time-spacer" />
            <span className="km-rail-col">
              <span className="km-spine-full" style={{ backgroundColor: railStroke }} />
            </span>
            <span />
          </div>
        </div>
      )}

      {/* Wiersz przyjazdu */}
      <div className="km-grid-row">
        <div className="km-endpoint-time">
          <time className="km-time-strong">
            {formatShareTime(sched.arrival)}
            {arrDay > 0 && <small className="km-day-small"> {s.dayLater(arrDay)}</small>}
          </time>
          {sched.arrDelayMin !== 0 && (
            <span className="km-time-strike">{formatShareTime(sched.baseArr)}</span>
          )}
        </div>

        <div className="km-rail-col" aria-hidden="true">
          <span className="km-spine-up" style={{ backgroundColor: railStroke }} />
          <span className="km-node-end" style={{ backgroundColor: railStroke }} />
        </div>

        <div className="km-arrival-content">
          <h3 className="km-stop-endpoint-title">{leg.to}</h3>
        </div>
      </div>
    </article>
  );
}

export default function SharedJourney({ hash }: { hash: string }) {
  const s = useShareStrings();
  const { sendSms, language } = useStrings();
  const locale = useWebLocale();
  const tripToken = useMemo(() => extractShareTripToken(hash).trip, [hash]);
  const journey = useMemo(
    () => (tripToken ? decodeSharedConnection(tripToken) : null),
    [tripToken],
  );
  const [stops, setStops] = useState<StaticStop[][]>([]);
  const [paths, setPaths] = useState<(RoutePoint[] | null)[]>([]);
  const [liveSnapshot, setLiveSnapshot] = useState<SharedWebLiveSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    setLiveSnapshot(null);
    if (!journey || journey.legs.every((leg) => leg.mode === 'walk')) return;
    let active = true;
    let controller: AbortController | null = null;

    const poll = () => {
      if (!active || document.hidden || !isJourneyInLiveWindow(journey, new Date())) return;
      controller?.abort();
      controller = new AbortController();
      void fetchSharedJourneyLive(journey, controller.signal).then((snapshot) => {
        if (active && snapshot) setLiveSnapshot(snapshot);
      });
    };

    poll();
    const timer = setInterval(poll, 20000);
    const onVis = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      active = false;
      clearInterval(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [journey]);

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
    setPaths([]);
    setFailed(false);
    setCopied(false);
    setLoading(false);
    if (!journey || journey.legs.every((leg) => leg.mode === 'walk')) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    setLoading(true);
    void loadSharedTimetable(journey, controller.signal)
      .then((result) => {
        if (active && !controller.signal.aborted) {
          setStops(result.stops);
          setPaths(result.paths);
          setFailed(
            journey.legs.some((leg, i) => leg.mode !== 'walk' && result.stops[i].length === 0),
          );
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

  if (!journey) {
    return (
      <main id="main" className="km-app-surface km-shared-shell km-shared-empty" tabIndex={-1}>
        <div className="km-empty-card">
          <span className="km-empty-icon" aria-hidden="true">
            <Link size={24} />
          </span>
          <h1>{s.invalidTitle}</h1>
          <p>{s.invalidBody}</p>
          <a className="km-primary-cta" href="#top">
            {s.home}
          </a>
        </div>
      </main>
    );
  }

  const cityName = CITIES.find((c) => c.id === journey.city)?.name ?? journey.city;
  const shortDate = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${journey.date}T12:00:00Z`));

  const liveLegs = liveSnapshot?.legs ?? [];
  const legSchedule: LegScheduleView[] = journey.legs.map((leg, idx) => {
    const live = liveLegs[idx] ?? null;
    const activeDelay =
      live && (live.status === 'live' || live.status === 'estimated')
        ? Math.round(live.delaySec / 60)
        : 0;
    const arrDelay =
      live && (live.status === 'live' || live.status === 'estimated')
        ? Math.round((live.arrivalDelaySec ?? live.delaySec) / 60)
        : 0;
    const baseDep =
      leg.scheduledDeparture !== undefined
        ? leg.scheduledDeparture +
          Math.round((leg.departure - leg.scheduledDeparture) / 1440) * 1440
        : leg.departure;
    const baseArr =
      leg.scheduledArrival !== undefined
        ? leg.scheduledArrival + Math.round((leg.arrival - leg.scheduledArrival) / 1440) * 1440
        : leg.arrival;
    const hasOverride = live != null && (live.status === 'live' || live.status === 'estimated');
    return {
      live,
      delayMin: activeDelay,
      arrDelayMin: arrDelay,
      departure: hasOverride ? baseDep + activeDelay : leg.departure,
      arrival: hasOverride ? baseArr + arrDelay : leg.arrival,
      baseDep,
      baseArr,
    };
  });

  const effectiveDeparture = legSchedule[0]?.departure ?? journey.departure;
  const effectiveArrival = legSchedule[legSchedule.length - 1]?.arrival ?? journey.arrival;
  const totalDurationMin = Math.max(0, effectiveArrival - effectiveDeparture);
  const overallArrivalDelayMin = effectiveArrival - journey.arrival;
  const hasAnyLive = Boolean(liveSnapshot?.hasAnyLive);
  const anyCancelled = legSchedule.some((item) => item.live?.cancelled);
  const anyEstimatedOnly =
    hasAnyLive &&
    !legSchedule.some((item) => item.live?.status === 'live') &&
    legSchedule.some((item) => item.live?.status === 'estimated');

  const arrivalDay = Math.floor(effectiveArrival / 1440);
  const elapsed = sharedJourneySeconds(journey.date, now);
  const depSec = effectiveDeparture * 60;
  const arrSec = effectiveArrival * 60;
  const ended = elapsed > arrSec;
  const started = elapsed >= depSec && !ended;
  const etaMin = started ? Math.max(1, Math.round((arrSec - elapsed) / 60)) : 0;
  const departInMin = !started && !ended ? Math.round((depSec - elapsed) / 60) : 0;
  const progressPct = started
    ? Math.max(4, Math.min(100, Math.round(((elapsed - depSec) / Math.max(60, arrSec - depSec)) * 100)))
    : 0;
  const showDepartBadge = !started && !ended && departInMin >= 1 && departInMin <= 180;
  const statusText = ended
    ? s.finished
    : showDepartBadge
      ? s.departsInMin(departInMin)
      : started
        ? s.inProgress
        : hasAnyLive
          ? s.vehicleLive
          : s.planned;

  const statusTone = ended
    ? 'ended'
    : started
      ? 'active'
      : showDepartBadge || hasAnyLive
        ? 'upcoming'
        : 'planned';

  // Znajdź aktywny odcinek w trasie, żeby pokazać bieżący krok w karcie Hero (jak w aplikacji).
  const activeLegIndex = started
    ? legSchedule.findIndex(
        (item) => elapsed >= item.departure * 60 && elapsed <= item.arrival * 60,
      )
    : -1;
  const activeLeg = activeLegIndex >= 0 ? journey.legs[activeLegIndex] : null;
  const activeLive = activeLegIndex >= 0 ? legSchedule[activeLegIndex]?.live : null;
  let stepSummary = '';
  if (started && activeLeg) {
    if (activeLeg.mode === 'walk') {
      stepSummary = s.walkingToStop(activeLeg.to);
    } else if (activeLive?.nextStop) {
      stepSummary = s.nextStopLabel(activeLive.nextStop);
    } else if (activeLeg.direction) {
      stepSummary = s.direction(activeLeg.direction);
    } else {
      stepSummary = s.inProgress;
    }
  }

  const liveClockLabel = liveSnapshot
    ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
        new Date(liveSnapshot.updatedAt),
      )
    : '';

  // Zawsze udostępniamy i kopiujemy najkrótszy kanoniczny link /t#<token>.
  let canonicalUrl = '';
  try {
    canonicalUrl = buildShareUrl(journey, locale);
  } catch {
    canonicalUrl = tripToken ? `https://kilometr.app/t#${tripToken}` : window.location.href;
  }
  const canonicalToken = canonicalUrl.includes('#') ? canonicalUrl.split('#')[1] : (tripToken ?? '');
  const pwaUrl = canonicalToken
    ? `https://web.kilometr.app/shared?trip=${canonicalToken}`
    : 'https://web.kilometr.app';
  const appDeepLink = canonicalToken
    ? `kilometr://shared?trip=${canonicalToken}`
    : 'kilometr://shared';

  const message = shareMessage(journey, s);
  const smsUrl = `sms:${/iPhone|iPad|iPod/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(`${message}\n${canonicalUrl}`)}`;
  const allWalk = journey.legs.every((leg) => leg.mode === 'walk');
  const transfersLabel = allWalk ? s.walk : s.transfers(transferCount(journey));

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(canonicalUrl);
      setCopied(true);
      setShareError(false);
    } catch {
      setShareError(true);
    }
  }

  async function share() {
    try {
      setShareError(false);
      if (navigator.share) {
        await navigator.share({ title: s.pageTitle, text: message, url: canonicalUrl });
      } else {
        await copyLink();
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setShareError(true);
    }
  }

  const mapNode = (
    <Suspense
      fallback={
        <section className="km-card km-map-card" aria-busy="true">
          <div className="km-map-empty">
            <span className="km-spinner" aria-hidden="true" />
            <p>{s.geometryLoading}</p>
          </div>
        </section>
      }
    >
      <SharedJourneyMap
        journey={journey}
        stopsByLeg={stops}
        pathsByLeg={paths}
        legTimes={legSchedule.map((item) => ({
          departure: item.departure,
          arrival: item.arrival,
        }))}
        liveLegs={liveLegs}
        elapsedSec={elapsed}
        ended={ended}
        loading={loading}
        onRetry={() => setRetry((n) => n + 1)}
      />
    </Suspense>
  );

  return (
    <main id="main" className="km-app-surface km-shared-shell" tabIndex={-1}>
      {/* Górny pasek aplikacji 1:1 z app/shared.tsx */}
      <header className="km-app-header">
        <a className="km-back-btn" href="#top" aria-label={s.home}>
          <ChevronLeft size={22} aria-hidden="true" />
        </a>

        <div className="km-header-copy">
          <h1>{s.pageTitle}</h1>
          <p>
            <span>{cityName}</span>
            <span aria-hidden="true"> {'\u00b7'} </span>
            <time dateTime={journey.date}>{shortDate}</time>
          </p>
        </div>

        <div className="km-header-actions">
          <a className="km-open-app-pill" href={appDeepLink}>
            <Smartphone size={16} aria-hidden="true" />
            <span>{s.openApp}</span>
          </a>

          <div className="km-action-cluster">
            <button
              type="button"
              className="km-cluster-btn"
              onClick={() => void share()}
              aria-label={s.share}
              title={s.share}
            >
              <Share2 size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`km-cluster-btn${copied ? ' is-active' : ''}`}
              onClick={() => void copyLink()}
              aria-label={copied ? s.copied : s.copy}
              title={copied ? s.copied : s.copy}
            >
              {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
            </button>
            <a
              className="km-cluster-btn"
              href={smsUrl}
              aria-label={sendSms}
              title={sendSms}
            >
              <MessageCircle size={18} aria-hidden="true" />
            </a>
          </div>
        </div>
      </header>

      <div className="km-split-layout">
        <div className="km-left-col">
          {/* Karta Hero 1:1 z SharedJourneyHero.tsx */}
          <section
            className="km-card km-hero-card"
            aria-label={s.cardLabel(journey.from, journey.to, formatShareTime(effectiveArrival))}
          >
            <div className="km-hero-topbar">
              <div className="km-hero-top-left">
                <span className={`km-status-pill is-${statusTone}`}>
                  {hasAnyLive && !ended ? (
                    <span className="km-live-pulse" aria-hidden="true" />
                  ) : ended ? (
                    <CheckCircle2 size={14} aria-hidden="true" />
                  ) : (
                    <Clock3 size={13} aria-hidden="true" />
                  )}
                  <span>{statusText}</span>
                </span>

                {hasAnyLive && !ended && (
                  <span
                    className={`km-delay-pill${
                      anyCancelled || overallArrivalDelayMin > 0
                        ? ' is-late'
                        : overallArrivalDelayMin < 0 || anyEstimatedOnly
                          ? ' is-warn'
                          : ' is-ontime'
                    }`}
                  >
                    {anyCancelled
                      ? s.cancelledService
                      : anyEstimatedOnly && overallArrivalDelayMin > 0
                        ? s.estimatedDelay(overallArrivalDelayMin)
                        : s.liveDelay(overallArrivalDelayMin)}
                  </span>
                )}
              </div>

              <span className="km-duration-pill">
                <Clock3 size={14} aria-hidden="true" />
                <span>{s.duration(totalDurationMin)}</span>
              </span>
            </div>

            {/* Horyzontalna oś Odjazd -> Przyjazd (z responsywnym układem piętrowym poniżej 360 px) */}
            <div className="km-route-axis">
              <div className="km-axis-times">
                <div className="km-axis-col is-left">
                  <span className="km-endpoint-tag">{s.departure}</span>
                  <time className="km-hero-time">{formatShareTime(effectiveDeparture)}</time>
                  {hasAnyLive && legSchedule[0] && legSchedule[0].delayMin !== 0 && (
                    <span className="km-hero-strike">
                      {s.scheduledTime(formatShareTime(legSchedule[0].baseDep))}
                    </span>
                  )}
                </div>

                <div className="km-axis-bridge">
                  <span className="km-arrow-desktop">
                    <M3ArrowRight color={ended ? '#899390' : '#5CDBBE'} />
                  </span>
                  <span className="km-arrow-mobile">
                    <M3ArrowDown color={ended ? '#899390' : '#5CDBBE'} />
                  </span>
                  <span className="km-bridge-pill">{transfersLabel}</span>
                </div>

                <div className="km-axis-col is-right">
                  <span className={`km-endpoint-tag${ended ? '' : ' is-primary'}`}>
                    {s.arrival}
                  </span>
                  <div className="km-arrival-inline">
                    {arrivalDay > 0 && <span className="km-day-badge">{s.dayLater(arrivalDay)}</span>}
                    <time className={`km-hero-time${ended ? '' : ' is-primary'}`}>
                      {formatShareTime(effectiveArrival)}
                    </time>
                  </div>
                  {hasAnyLive && overallArrivalDelayMin !== 0 && (
                    <span className="km-hero-strike">
                      {s.scheduledTime(formatShareTime(journey.arrival))}
                    </span>
                  )}
                </div>
              </div>

              <div className="km-axis-places">
                <p className="km-place-left">{journey.from}</p>
                <p className="km-place-right">{journey.to}</p>
              </div>
            </div>

            {/* Postęp w trakcie podróży */}
            {started && !ended && (
              <div className="km-progress-box" aria-live="polite">
                <div className="km-progress-top">
                  <div className="km-step-left">
                    {activeLeg ? (
                      <LegLineBadge leg={activeLeg} city={journey.city} compact />
                    ) : null}
                    <span className="km-step-text">{stepSummary || s.inProgress}</span>
                  </div>
                  {etaMin >= 1 && <span className="km-eta-pill">{s.etaInMin(etaMin)}</span>}
                </div>
                <div className="km-progress-track" aria-hidden="true">
                  <span className="km-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            )}

            {/* Proporcjonalny JourneyStrip jak w aplikacji */}
            <div className={`km-strip-surface${ended ? ' is-dimmed' : ''}`}>
              <div className="km-strip-badges">
                {journey.legs.map((leg, i) => {
                  const walkMin = Math.max(1, leg.arrival - leg.departure);
                  if (leg.mode === 'walk') {
                    return (
                      <span key={i} className="km-strip-walk">
                        <Footprints size={13} aria-hidden="true" />
                        <span>{walkMin}&apos;</span>
                      </span>
                    );
                  }
                  return <LegLineBadge key={i} leg={leg} city={journey.city} compact />;
                })}
              </div>
              <div className="km-strip-bar" aria-hidden="true">
                {journey.legs.map((leg, i) => {
                  const dur = Math.max(1, (legSchedule[i]?.arrival ?? leg.arrival) - (legSchedule[i]?.departure ?? leg.departure));
                  const isWalk = leg.mode === 'walk';
                  const railAgency =
                    leg.mode === 'train' ? inferRailAgencyFromLine(leg.line, journey.city) : undefined;
                  const bg = isWalk
                    ? undefined
                    : resolveLineBadgeIdentity({
                        mode: leg.mode,
                        line: leg.line,
                        compact: true,
                        cityId: journey.city,
                        railAgencyOverride: railAgency,
                      }).bg;
                  return (
                    <span
                      key={i}
                      className={`km-strip-seg${isWalk ? ' is-walk' : ''}`}
                      style={{
                        flexGrow: dur,
                        backgroundColor: bg,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </section>

          {/* Mapa na mobile i tablecie w kolejności jak w aplikacji */}
          <div className="km-map-mobile-slot">{mapNode}</div>

          {/* 3-kolumnowa oś czasu 1:1 z LegTimeline.tsx */}
          <section className="km-itinerary-section" aria-labelledby="itinerary-title">
            <div className="km-itinerary-header">
              <h2 id="itinerary-title">{s.itinerary}</h2>
              {loading && (
                <span className="km-loading-chip" role="status" aria-live="polite">
                  <span className="km-spinner is-sm" aria-hidden="true" />
                  <span>{s.loading}</span>
                </span>
              )}
            </div>

            <div className="km-leg-list">
              {journey.legs.map((leg, i) => {
                const sched = legSchedule[i];
                const nextLeg = journey.legs[i + 1];
                const nextSched = legSchedule[i + 1];

                if (leg.mode === 'walk') {
                  const walkDur = Math.max(1, sched.arrival - sched.departure);
                  return (
                    <div key={i} className="km-connector-row">
                      <div className="km-connector-time">{s.duration(walkDur)}</div>
                      <div className="km-rail-col" aria-hidden="true">
                        <span className="km-connector-tick" />
                        <span className="km-walk-circle">
                          <Footprints size={14} />
                        </span>
                        <span className="km-connector-tick" />
                      </div>
                      <div className="km-connector-copy">
                        <strong>
                          {leg.walk != null ? s.walkDistance(leg.walk) : s.walk}
                        </strong>
                        <span>
                          {leg.from} {'\u2192'} {leg.to}
                        </span>
                      </div>
                    </div>
                  );
                }

                const implicitTransferGap =
                  nextLeg && nextLeg.mode !== 'walk' && nextSched
                    ? Math.max(0, nextSched.departure - sched.arrival)
                    : null;

                return (
                  <div key={i} className="km-leg-group">
                    <TransitLegCard
                      leg={leg}
                      city={journey.city}
                      sched={sched}
                      stops={stops[i] ?? []}
                      elapsedSec={elapsed}
                    />

                    {implicitTransferGap !== null && (
                      <div className="km-connector-row">
                        <div className="km-connector-time">
                          {implicitTransferGap > 0 ? s.duration(implicitTransferGap) : ''}
                        </div>
                        <div className="km-rail-col" aria-hidden="true">
                          <span className="km-connector-tick" />
                          <span className="km-walk-circle">
                            <Footprints size={14} />
                          </span>
                          <span className="km-connector-tick" />
                        </div>
                        <div className="km-connector-copy">
                          <strong>{s.transferLabel}</strong>
                          {nextLeg.platform || nextLeg.track ? (
                            <span>{s.platformLabel(nextLeg.platform, nextLeg.track)}</span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!loading && failed && (
              <div className="km-retry-card" role="status">
                <p>{s.stopsUnavailable}</p>
                <button
                  type="button"
                  className="km-tonal-btn"
                  onClick={() => setRetry((n) => n + 1)}
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  <span>{s.retry}</span>
                </button>
              </div>
            )}
          </section>

          {/* Dolny pasek notki + akcji otwarcia w pełnym PWA */}
          <div className="km-bottom-panel">
            <p className="km-status-footnote">
              {hasAnyLive ? (
                s.liveStatusNote(liveClockLabel)
              ) : (
                <>
                  {s.snapshot}
                  {journey.legs.some((leg) => leg.mode !== 'walk') ? ` ${s.positionNote}` : ''}
                </>
              )}
            </p>

            {shareError && (
              <p className="km-error-banner" role="alert">
                {s.error}
              </p>
            )}

            <div className="km-bottom-links">
              <a className="km-pwa-link" href={pwaUrl}>
                <ExternalLink size={15} aria-hidden="true" />
                <span>{s.openInPwa}</span>
              </a>

              <div className="km-mini-footer">
                <a className="km-mini-brand" href="#top">
                  <img src="./icon.png" alt="" width={18} height={18} />
                  <span>{s.brand}</span>
                </a>
                <label className="km-lang-pill">
                  <span className="sr-only">{language}</span>
                  <select
                    value={locale}
                    onChange={(event) => setWebLocale(event.target.value as Locale)}
                  >
                    <option value="pl">PL</option>
                    <option value="en">EN</option>
                    <option value="de">DE</option>
                    <option value="uk">UK</option>
                  </select>
                  <ChevronDown size={12} aria-hidden="true" />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Prawa kolumna na desktopie (1024px+): pełnowymiarowa sticky mapa 1:1 z PWA */}
        <aside className="km-right-col" aria-label={s.map}>
          {mapNode}
        </aside>
      </div>
    </main>
  );
}
