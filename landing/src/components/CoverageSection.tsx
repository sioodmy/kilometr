import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  CableCar,
  Check,
  ChevronDown,
  Clock,
  MapPin,
  Megaphone,
  Radio,
  Search,
  X,
} from 'lucide-react';
import { RAIL_ICON_SPECS, type RailAgency } from '../../../src/services/railIconPaths';
import { useStrings, useWebLocale } from '../i18n';
import { useReleaseCopy } from '../landingCopy';
import {
  COVERAGE_CITIES,
  filterCoveragePlaces,
  findMatchedAlias,
  normalizeCoverageQuery,
  type CoveragePlace,
  type OperatorEntry,
} from '../coverageData';
import { getCoverageStats } from '../coverageStats';
import { POLAND_OUTLINE, projectPolandPoint } from '../mapProjection';
import { CITY_CRESTS, CityCrestStrip, RailCarrierStrip } from './kilometrUi';
import './coverageSection.css';

const MAP_VIEWBOX_SIZE = 600;

// Nationwide Intercity rail backbone connecting Poland's major hubs.
const RAIL_LINKS: readonly (readonly [string, string])[] = [
  ['trojmiasto', 'warszawa'],
  ['trojmiasto', 'bydgoszcz'],
  ['bydgoszcz', 'poznan'],
  ['szczecin', 'poznan'],
  ['poznan', 'warszawa'],
  ['poznan', 'wroclaw'],
  ['warszawa', 'lodz'],
  ['lodz', 'wroclaw'],
  ['warszawa', 'bialystok'],
  ['warszawa', 'lublin'],
  ['warszawa', 'krakow'],
  ['warszawa', 'gzm'],
  ['wroclaw', 'gzm'],
  ['gzm', 'krakow'],
  ['krakow', 'rzeszow'],
  ['warszawa', 'olsztyn'],
];

// Gentle quadratic arc so rail corridors and moving light streaks feel fluid and organic.
function buildRailArc(
  a: { x: number; y: number },
  b: { x: number; y: number },
  index: number,
): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const bend = Math.min(14, dist * 0.085) * (index % 2 === 0 ? 1 : -1);
  const cx = mx - (dy / dist) * bend;
  const cy = my + (dx / dist) * bend;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

// Wyższy łuk kartograficzny pokazujący relację między wybranym a najechanym miastem.
function buildHoverArc(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const bend = Math.min(34, Math.max(10, dist * 0.16));
  const nx = -dy / dist;
  const ny = dx / dist;
  const dir = ny <= 0 ? 1 : -1;
  const cx = mx + nx * bend * dir;
  const cy = my + ny * bend * dir;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function RailOperatorSvg({ agency }: { agency: RailAgency }) {
  const spec = RAIL_ICON_SPECS[agency];
  const hasScale = 'scale' in spec && spec.scale != null;
  const hasTranslateY = 'translateY' in spec && spec.translateY != null;
  const transform = hasScale
    ? hasTranslateY
      ? `scale(${spec.scale}) translate(0, ${spec.translateY})`
      : `scale(${spec.scale})`
    : undefined;

  return (
    <svg width={19} height={19} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {transform ? (
        <g transform={transform}>
          {spec.paths.map((d, idx) => (
            <path key={idx} d={d} />
          ))}
        </g>
      ) : (
        spec.paths.map((d, idx) => <path key={idx} d={d} />)
      )}
    </svg>
  );
}

function OperatorLogo({ operator, cityKey }: { operator: OperatorEntry; cityKey: string }) {
  if (operator.railAgency) {
    return (
      <span className="cov-op-logo" aria-hidden="true">
        <RailOperatorSvg agency={operator.railAgency} />
      </span>
    );
  }
  if (operator.kind === 'cable') {
    return (
      <span className="cov-op-logo" aria-hidden="true">
        <CableCar size={17} strokeWidth={1.9} />
      </span>
    );
  }
  const crest = CITY_CRESTS.find((city) => city.cityKey === cityKey);
  if (crest) {
    return (
      <span className="cov-op-logo cov-op-crest" aria-hidden="true">
        <img
          src={crest.src}
          alt=""
          width={crest.width}
          height={crest.height}
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }
  const len = operator.shortCode.length;
  const sizeClass = len >= 5 ? ' is-xs' : len === 4 ? ' is-sm' : '';
  return (
    <span className={`cov-op-logo cov-op-monogram${sizeClass}`} aria-hidden="true">
      {operator.shortCode}
    </span>
  );
}

function computeCalloutPosition(
  x: number,
  y: number,
  label: string,
  dotR: number,
): { boxX: number; boxY: number; boxW: number; textX: number; textY: number } {
  const boxW = Math.max(82, Math.round(label.length * 7.6 + 26));
  const boxH = 28;
  const boxX = Math.max(10, Math.min(MAP_VIEWBOX_SIZE - boxW - 10, x - boxW / 2));
  const clearance = Math.round(dotR + 13);
  const placeBelow = y < clearance + boxH + 10;
  const boxY = placeBelow ? y + clearance : y - boxH - clearance;
  return {
    boxX,
    boxY,
    boxW,
    textX: boxX + boxW / 2,
    textY: boxY + 18,
  };
}

export function CoverageSection() {
  const s = useStrings();
  const c = s.coverage;
  const locale = useWebLocale();
  const releaseCopy = useReleaseCopy(locale);

  const listboxId = useId();
  const inputId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const mapCanvasRef = useRef<HTMLDivElement>(null);
  const cursorLayerRef = useRef<SVGGElement>(null);
  const cursorGlowRef = useRef<SVGRadialGradientElement>(null);
  const borderGlowRef = useRef<SVGRadialGradientElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [selectedKey, setSelectedKey] = useState<string>('wroclaw');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [inView, setInView] = useState(false);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const cityCount = COVERAGE_CITIES.length;

  const projectedCities = useMemo(
    () =>
      COVERAGE_CITIES.map((place) => {
        const pt = projectPolandPoint(place.lon, place.lat);
        const cityStats = getCoverageStats(place.key);
        return { place, x: pt.x, y: pt.y, hasLive: cityStats.live.available };
      }),
    [],
  );

  const projectedByKey = useMemo(
    () => new Map(projectedCities.map((entry) => [entry.place.key as string, entry])),
    [projectedCities],
  );

  const railCorridors = useMemo(
    () =>
      RAIL_LINKS.map(([fromId, toId], idx) => {
        const a = projectedByKey.get(fromId);
        const b = projectedByKey.get(toId);
        if (!a || !b) return null;
        return {
          id: `${fromId}-${toId}`,
          fromId,
          toId,
          d: buildRailArc(a, b, idx),
          duration: (7.8 + ((idx * 1.37) % 5.2)).toFixed(2),
          delay: (-((idx * 2.13) % 11.4)).toFixed(2),
          reverse: idx % 3 === 1,
        };
      }).filter((item): item is NonNullable<typeof item> => item !== null),
    [projectedByKey],
  );

  const sortedCities = useMemo(
    () => [...COVERAGE_CITIES].sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    [],
  );

  const filteredCities = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return sortedCities;
    return filterCoveragePlaces(trimmed);
  }, [query, sortedCities]);

  const matchedKeys = useMemo(
    () => new Set(filteredCities.map((place) => place.key)),
    [filteredCities],
  );

  const isSearching = query.trim().length > 0;

  const orderedProjectedCities = useMemo(() => {
    const activeKey = hoveredKey ?? selectedKey;
    const rank = (key: CoveragePlace['key']) => {
      if (key === activeKey) return 3;
      if (key === selectedKey) return 2;
      if (isSearching && matchedKeys.has(key)) return 1;
      return 0;
    };
    return [...projectedCities].sort(
      (a, b) => rank(a.place.key) - rank(b.place.key) || a.place.populationK - b.place.populationK,
    );
  }, [projectedCities, isSearching, matchedKeys, hoveredKey, selectedKey]);

  const selectedPlace: CoveragePlace = useMemo(
    () => COVERAGE_CITIES.find((place) => place.key === selectedKey) ?? COVERAGE_CITIES[0]!,
    [selectedKey],
  );

  const stats = getCoverageStats(selectedPlace.key);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.05,
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  // Płynny spotlight na mapie Polski i delikatny przechył 3D bez re-renderów Reacta.
  useEffect(() => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let lastAt = performance.now();
    let active = false;
    let targetX = MAP_VIEWBOX_SIZE / 2;
    let targetY = MAP_VIEWBOX_SIZE / 2;
    let smoothX = targetX;
    let smoothY = targetY;
    let alpha = 0;
    let tiltX = 0;
    let tiltY = 0;

    const applyVisuals = () => {
      const layer = cursorLayerRef.current;
      const fillGrad = cursorGlowRef.current;
      const borderGrad = borderGlowRef.current;
      const cx = smoothX.toFixed(1);
      const cy = smoothY.toFixed(1);
      if (fillGrad) {
        fillGrad.setAttribute('cx', cx);
        fillGrad.setAttribute('cy', cy);
      }
      if (borderGrad) {
        borderGrad.setAttribute('cx', cx);
        borderGrad.setAttribute('cy', cy);
      }
      if (layer) {
        layer.setAttribute('opacity', alpha.toFixed(3));
      }
      canvas.style.setProperty('--map-rx', `${tiltX.toFixed(2)}deg`);
      canvas.style.setProperty('--map-ry', `${tiltY.toFixed(2)}deg`);
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastAt) / 1000));
      lastAt = now;

      if (reduced.matches) {
        alpha = 0;
        tiltX = 0;
        tiltY = 0;
        applyVisuals();
        return;
      }

      const wasIdle = alpha < 0.01;
      const targetAlpha = active ? 1 : 0;
      const alphaEase = 1 - Math.exp(-dt * (active ? 8.5 : 4.8));
      alpha += (targetAlpha - alpha) * alphaEase;
      if (!active && alpha < 0.003) alpha = 0;

      if (active) {
        if (wasIdle) {
          smoothX = targetX;
          smoothY = targetY;
        } else {
          const posEase = 1 - Math.exp(-dt * 14);
          smoothX += (targetX - smoothX) * posEase;
          smoothY += (targetY - smoothY) * posEase;
        }
      }

      const allowTilt = window.innerWidth >= 960 && alpha > 0.003;
      const nx = allowTilt ? Math.max(-1, Math.min(1, (smoothX / MAP_VIEWBOX_SIZE) * 2 - 1)) : 0;
      const ny = allowTilt ? Math.max(-1, Math.min(1, (smoothY / MAP_VIEWBOX_SIZE) * 2 - 1)) : 0;
      const targetTiltX = -ny * 2.2 * alpha;
      const targetTiltY = nx * 2.4 * alpha;
      const tiltEase = 1 - Math.exp(-dt * 6);
      tiltX += (targetTiltX - tiltX) * tiltEase;
      tiltY += (targetTiltY - tiltY) * tiltEase;
      if (!active && Math.abs(tiltX) < 0.015 && Math.abs(tiltY) < 0.015) {
        tiltX = 0;
        tiltY = 0;
      }

      applyVisuals();

      if (active || alpha > 0 || Math.abs(tiltX) > 0 || Math.abs(tiltY) > 0) {
        raf = requestAnimationFrame(tick);
      }
    };

    const schedule = () => {
      if (!raf) {
        lastAt = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    const handleMove = (event: PointerEvent) => {
      if (reduced.matches || event.pointerType === 'touch') return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      targetX = ((event.clientX - rect.left) / rect.width) * MAP_VIEWBOX_SIZE;
      targetY = ((event.clientY - rect.top) / rect.height) * MAP_VIEWBOX_SIZE;
      active = true;
      schedule();
    };

    const handleLeave = () => {
      active = false;
      schedule();
    };

    const handleReducedChange = () => {
      if (reduced.matches) {
        active = false;
        schedule();
      }
    };

    canvas.addEventListener('pointermove', handleMove, { passive: true });
    canvas.addEventListener('pointerleave', handleLeave);
    reduced.addEventListener('change', handleReducedChange);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('pointerleave', handleLeave);
      reduced.removeEventListener('change', handleReducedChange);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex]);

  const selectPlace = (place: CoveragePlace, closeDropdown = false) => {
    setSelectedKey(place.key);
    if (closeDropdown) {
      setIsOpen(false);
      setActiveIndex(-1);
      setQuery('');
    }
  };

  const resetSearch = () => {
    setQuery('');
    setActiveIndex(0);
    setIsOpen(true);
    inputRef.current?.focus();
  };

  const handlePinKeyDown = (event: KeyboardEvent<SVGGElement>, place: CoveragePlace) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectPlace(place);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(0);
        return;
      }
      if (filteredCities.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filteredCities.length);
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(Math.max(0, filteredCities.length - 1));
        return;
      }
      if (filteredCities.length > 0) {
        setActiveIndex((prev) => (prev <= 0 ? filteredCities.length - 1 : prev - 1));
      }
    } else if (event.key === 'Enter') {
      if (isOpen && filteredCities.length > 0) {
        event.preventDefault();
        const target = filteredCities[activeIndex >= 0 ? activeIndex : 0];
        if (target) selectPlace(target, true);
      }
    } else if (event.key === 'Escape') {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
      } else if (query) {
        event.preventDefault();
        setQuery('');
      }
    }
  };

  const activeCalloutItem = useMemo(() => {
    const key = hoveredKey ?? selectedPlace.key;
    return projectedCities.find((item) => item.place.key === key) ?? null;
  }, [hoveredKey, selectedPlace.key, projectedCities]);

  const hoverArc = useMemo(() => {
    if (!hoveredKey || hoveredKey === selectedPlace.key) return null;
    const from = projectedByKey.get(selectedPlace.key);
    const to = projectedByKey.get(hoveredKey);
    if (!from || !to) return null;
    return {
      key: `${selectedPlace.key}-${hoveredKey}`,
      d: buildHoverArc(from, to),
    };
  }, [hoveredKey, selectedPlace.key, projectedByKey]);

  const activeOptionId =
    isOpen && activeIndex >= 0 && filteredCities[activeIndex]
      ? `${listboxId}-opt-${filteredCities[activeIndex]!.key}`
      : undefined;

  return (
    <section
      id="zasieg"
      ref={sectionRef}
      className={`release-section coverage-release${inView ? ' is-in-view' : ''}`}
      aria-labelledby="coverage-title"
    >
      <div className="release-inner">
        <div className="release-head release-head-center">
          <h2 className="release-title" id="coverage-title">
            {c.title}
          </h2>
          <p className="release-lead">{c.body(cityCount)}</p>
        </div>

        {/* Marquee rail carrier & supported city crest chips positioned above the coverage map */}
        <div className="cov-rail-band">
          <RailCarrierStrip label={releaseCopy.transfers.railLabel} />
          <CityCrestStrip
            label={c.citiesListLabel}
            selectedCityKey={selectedPlace.key}
            onSelectCity={(cityKey) => {
              const target = COVERAGE_CITIES.find((place) => place.key === cityKey);
              if (target) selectPlace(target, true);
            }}
          />
        </div>

        <div className="cov-board">
          {/* Left Pane: Precision Cartographic Poland Map */}
          <div className="cov-map-pane">
            <div className="cov-map-canvas" ref={mapCanvasRef}>
              <svg
                className="cov-map-svg"
                viewBox={`0 0 ${MAP_VIEWBOX_SIZE} ${MAP_VIEWBOX_SIZE}`}
                role="img"
                aria-label={c.mapAria}
              >
                <defs>
                  <linearGradient id="covPolandFill" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#172c23" />
                    <stop offset="55%" stopColor="#11201a" />
                    <stop offset="100%" stopColor="#0c1713" />
                  </linearGradient>
                  <radialGradient id="covMapAura" cx="50%" cy="48%" r="52%">
                    <stop offset="0%" stopColor="#5cdbbe" stopOpacity="0.14" />
                    <stop offset="68%" stopColor="#5cdbbe" stopOpacity="0.03" />
                    <stop offset="100%" stopColor="#5cdbbe" stopOpacity="0" />
                  </radialGradient>
                  <clipPath id="covPolandClip">
                    <path d={POLAND_OUTLINE} />
                  </clipPath>
                  <radialGradient
                    id="covCursorGlow"
                    ref={cursorGlowRef}
                    gradientUnits="userSpaceOnUse"
                    cx={MAP_VIEWBOX_SIZE / 2}
                    cy={MAP_VIEWBOX_SIZE / 2}
                    r={175}
                  >
                    <stop offset="0%" stopColor="#7fdbb1" stopOpacity="0.2" />
                    <stop offset="46%" stopColor="#5cdbbe" stopOpacity="0.075" />
                    <stop offset="100%" stopColor="#5cdbbe" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient
                    id="covBorderGlow"
                    ref={borderGlowRef}
                    gradientUnits="userSpaceOnUse"
                    cx={MAP_VIEWBOX_SIZE / 2}
                    cy={MAP_VIEWBOX_SIZE / 2}
                    r={160}
                  >
                    <stop offset="0%" stopColor="#b0f8e2" stopOpacity="0.88" />
                    <stop offset="45%" stopColor="#5cdbbe" stopOpacity="0.34" />
                    <stop offset="100%" stopColor="#5cdbbe" stopOpacity="0" />
                  </radialGradient>
                  <filter id="covLandShadow" x="-12%" y="-12%" width="124%" height="124%">
                    <feDropShadow
                      dx="0"
                      dy="16"
                      stdDeviation="18"
                      floodColor="#000000"
                      floodOpacity="0.48"
                    />
                  </filter>
                  <filter id="covStreakGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="1.15" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                <circle
                  cx={MAP_VIEWBOX_SIZE / 2}
                  cy={MAP_VIEWBOX_SIZE / 2}
                  r={270}
                  fill="url(#covMapAura)"
                />

                <path
                  className="cov-poland-land"
                  d={POLAND_OUTLINE}
                  fill="url(#covPolandFill)"
                  filter="url(#covLandShadow)"
                />

                <g ref={cursorLayerRef} className="cov-cursor-layer" opacity="0" aria-hidden="true">
                  <rect
                    x={0}
                    y={0}
                    width={MAP_VIEWBOX_SIZE}
                    height={MAP_VIEWBOX_SIZE}
                    fill="url(#covCursorGlow)"
                    clipPath="url(#covPolandClip)"
                  />
                  <path
                    className="cov-poland-border-glow"
                    d={POLAND_OUTLINE}
                    fill="none"
                    stroke="url(#covBorderGlow)"
                  />
                </g>

                {/* Subtle Intercity rail corridors + quiet gliding light streaks between major cities */}
                <g className="cov-rail-links" aria-hidden="true">
                  {railCorridors.map((corridor) => {
                    const touchesActive =
                      corridor.fromId === selectedPlace.key || corridor.toId === selectedPlace.key;
                    const touchesHovered =
                      hoveredKey != null &&
                      hoveredKey !== selectedPlace.key &&
                      (corridor.fromId === hoveredKey || corridor.toId === hoveredKey);
                    const linkClass = `cov-rail-link${touchesActive ? ' is-active' : ''}${touchesHovered ? ' is-hovered' : ''}`;
                    const streakClass = `cov-rail-streak${touchesActive ? ' is-active' : ''}${touchesHovered ? ' is-hovered' : ''}`;
                    return (
                      <g key={corridor.id}>
                        <path d={corridor.d} fill="none" className={linkClass} />
                        <path
                          d={corridor.d}
                          fill="none"
                          pathLength={100}
                          filter={
                            touchesActive || touchesHovered ? 'url(#covStreakGlow)' : undefined
                          }
                          className={streakClass}
                          style={{
                            animationDuration: `${corridor.duration}s`,
                            animationDelay: `${corridor.delay}s`,
                            animationDirection: corridor.reverse ? 'reverse' : 'normal',
                          }}
                        />
                      </g>
                    );
                  })}
                </g>

                {hoverArc && (
                  <g key={hoverArc.key} className="cov-hover-route" aria-hidden="true">
                    <path d={hoverArc.d} fill="none" className="cov-hover-arc-glow" />
                    <path d={hoverArc.d} fill="none" pathLength={100} className="cov-hover-arc" />
                    <path
                      d={hoverArc.d}
                      fill="none"
                      pathLength={100}
                      className="cov-hover-arc-pulse"
                    />
                  </g>
                )}

                {orderedProjectedCities.map(({ place, x, y, hasLive }) => {
                  const isSelected = place.key === selectedPlace.key;
                  const isHovered = place.key === hoveredKey;
                  const isDimmed = isSearching && !matchedKeys.has(place.key) && !isSelected;
                  const baseR = place.pinRadius;
                  const dotR = Number(
                    (isSelected ? baseR + 2 : isHovered ? baseR + 1.4 : baseR).toFixed(2),
                  );
                  const hitR = Number(
                    Math.max(8, baseR + Math.max(1.2, 5 - baseR * 0.45)).toFixed(2),
                  );
                  const ringR = Number((baseR + 5.8).toFixed(2));
                  const haloR = Number((baseR + 11.2).toFixed(2));

                  return (
                    <g
                      key={place.key}
                      className={`cov-pin${isSelected ? ' is-selected' : ''}${isHovered ? ' is-hovered' : ''}${isDimmed ? ' is-dimmed' : ''}${hasLive ? ' has-live' : ''}`}
                      transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)})`}
                      role="button"
                      tabIndex={0}
                      aria-label={
                        place.regionLabel ? `${place.name} (${place.regionLabel})` : place.name
                      }
                      aria-pressed={isSelected}
                      onClick={() => selectPlace(place)}
                      onKeyDown={(e) => handlePinKeyDown(e, place)}
                      onMouseEnter={() => setHoveredKey(place.key)}
                      onMouseLeave={() =>
                        setHoveredKey((prev) => (prev === place.key ? null : prev))
                      }
                      onFocus={() => setHoveredKey(place.key)}
                      onBlur={() => setHoveredKey((prev) => (prev === place.key ? null : prev))}
                    >
                      <circle className="cov-pin-hit" r={hitR} cx={0} cy={0} />
                      {isSelected && (
                        <>
                          <circle className="cov-pin-pulse" r={haloR + 3} cx={0} cy={0} />
                          <circle className="cov-pin-halo" r={haloR} cx={0} cy={0} />
                          <circle className="cov-pin-ring" r={ringR} cx={0} cy={0} />
                        </>
                      )}
                      {isHovered && !isSelected && (
                        <>
                          <circle className="cov-pin-hover-halo" r={haloR - 1.4} cx={0} cy={0} />
                          <circle className="cov-pin-hover-ring" r={ringR - 0.6} cx={0} cy={0} />
                        </>
                      )}
                      <circle className="cov-pin-dot" r={dotR} cx={0} cy={0} />
                      {isSelected && <circle className="cov-pin-core" r={2.3} cx={0} cy={0} />}
                    </g>
                  );
                })}

                {activeCalloutItem &&
                  (() => {
                    const activeR =
                      activeCalloutItem.place.pinRadius +
                      (activeCalloutItem.place.key === selectedPlace.key ? 2 : 1.4);
                    const pos = computeCalloutPosition(
                      activeCalloutItem.x,
                      activeCalloutItem.y,
                      activeCalloutItem.place.name,
                      activeR,
                    );
                    return (
                      <g
                        key={activeCalloutItem.place.key}
                        className="cov-callout"
                        pointerEvents="none"
                        aria-hidden="true"
                      >
                        <rect x={pos.boxX} y={pos.boxY} width={pos.boxW} height={28} rx={14} />
                        <text x={pos.textX} y={pos.textY} textAnchor="middle">
                          {activeCalloutItem.place.name}
                        </text>
                      </g>
                    );
                  })()}
              </svg>
            </div>
          </div>

          {/* Right Pane: Search + Precision City Inspector */}
          <div className="cov-inspector-pane">
            <div className="cov-picker" ref={pickerRef}>
              <div className={`cov-combobox${isOpen ? ' is-open' : ''}`}>
                <Search
                  className="cov-combobox-icon"
                  size={17}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <input
                  ref={inputRef}
                  id={inputId}
                  type="text"
                  className="cov-combobox-input"
                  value={query}
                  role="combobox"
                  aria-expanded={isOpen}
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={activeOptionId}
                  aria-label={c.searchLabel}
                  placeholder={c.searchPlaceholder}
                  onFocus={() => {
                    setIsOpen(true);
                    setActiveIndex((prev) => (prev >= 0 ? prev : 0));
                  }}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setIsOpen(true);
                    setActiveIndex(0);
                  }}
                  onKeyDown={handleInputKeyDown}
                />
                {query ? (
                  <button
                    type="button"
                    className="cov-combobox-action"
                    onClick={resetSearch}
                    aria-label={c.clearSearch}
                  >
                    <X size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="cov-combobox-action cov-combobox-chevron"
                    aria-label={c.browseListLabel}
                    aria-expanded={isOpen}
                    aria-controls={listboxId}
                    onClick={() => {
                      setIsOpen((prev) => {
                        const next = !prev;
                        if (next) setActiveIndex(0);
                        return next;
                      });
                      inputRef.current?.focus();
                    }}
                  >
                    <ChevronDown size={17} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>

              {isOpen && (
                <div
                  className="cov-popover"
                  id={listboxId}
                  role="listbox"
                  aria-label={c.citiesListLabel}
                >
                  {filteredCities.length > 0 ? (
                    filteredCities.map((place, index) => {
                      const isSelected = place.key === selectedPlace.key;
                      const isHighlighted = index === activeIndex;
                      const matchedAlias = findMatchedAlias(place, query);
                      const aliasAlreadyShown =
                        matchedAlias != null &&
                        place.regionLabel != null &&
                        normalizeCoverageQuery(place.regionLabel).includes(
                          normalizeCoverageQuery(matchedAlias),
                        );
                      const secondary =
                        matchedAlias && !aliasAlreadyShown
                          ? place.regionLabel
                            ? `${matchedAlias} · ${place.regionLabel}`
                            : matchedAlias
                          : place.regionLabel;

                      return (
                        <button
                          key={place.key}
                          ref={(el) => {
                            optionRefs.current[index] = el;
                          }}
                          id={`${listboxId}-opt-${place.key}`}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`cov-option${isSelected ? ' is-selected' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
                          onMouseEnter={() => {
                            setActiveIndex(index);
                            setHoveredKey(place.key);
                          }}
                          onMouseLeave={() =>
                            setHoveredKey((prev) => (prev === place.key ? null : prev))
                          }
                          onClick={() => selectPlace(place, true)}
                        >
                          <span className="cov-option-main">
                            <span className="cov-option-name">{place.name}</span>
                            {secondary && <span className="cov-option-meta">{secondary}</span>}
                          </span>
                          {isSelected && <Check size={15} strokeWidth={2.3} aria-hidden="true" />}
                        </button>
                      );
                    })
                  ) : (
                    <div className="cov-empty">
                      <p className="cov-empty-title">{c.emptyTitle}</p>
                      <p className="cov-empty-body">{c.emptyBody}</p>
                      <button type="button" className="cov-empty-reset" onClick={resetSearch}>
                        {c.emptyReset}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="cov-spotlight" aria-live="polite">
              <div className="cov-spot-head">
                <div>
                  <h3>{selectedPlace.name}</h3>
                  {selectedPlace.regionLabel && (
                    <p className="cov-spot-sub">{selectedPlace.regionLabel}</p>
                  )}
                </div>
              </div>

              <div className="cov-metrics">
                <div className={`cov-metric${stats.live.available ? ' is-on' : ' is-off'}`}>
                  <span className="cov-metric-k">
                    {stats.live.available ? (
                      <Radio size={15} strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <Clock size={15} strokeWidth={2} aria-hidden="true" />
                    )}
                    <span>{c.liveLabel}</span>
                  </span>
                  <span className="cov-metric-v">
                    {stats.live.available ? c.available : c.liveUnavailable}
                  </span>
                  {stats.live.available && (
                    <span className="cov-metric-sub">{c.liveValue(stats.live.vehicles)}</span>
                  )}
                </div>

                <div className={`cov-metric${stats.news.available ? ' is-on' : ' is-off'}`}>
                  <span className="cov-metric-k">
                    <Megaphone size={15} strokeWidth={2} aria-hidden="true" />
                    <span>{c.newsLabel}</span>
                  </span>
                  <span className="cov-metric-v">
                    {stats.news.available ? c.available : c.newsUnavailable}
                  </span>
                  {stats.news.available && selectedPlace.newsSource && (
                    <span className="cov-metric-sub">{selectedPlace.newsSource}</span>
                  )}
                </div>

                <div className={`cov-metric${stats.stopHints.available ? ' is-on' : ' is-off'}`}>
                  <span className="cov-metric-k">
                    <MapPin size={15} strokeWidth={2} aria-hidden="true" />
                    <span>{c.stopHintsLabel}</span>
                  </span>
                  <span className="cov-metric-v">
                    {stats.stopHints.available ? c.available : c.stopHintsUnavailable}
                  </span>
                  {stats.stopHints.available && (
                    <span className="cov-metric-sub">
                      {c.stopHintsValue(stats.stopHints.stops ?? 0)}
                    </span>
                  )}
                </div>
              </div>

              <div className="cov-ops">
                <p className="cov-ops-label">{c.operatorsLabel}</p>
                <ul className="cov-ops-list">
                  {selectedPlace.operators.map((op) => (
                    <li key={op.id} className="cov-op-row">
                      <OperatorLogo operator={op} cityKey={selectedPlace.key} />
                      <span className="cov-op-name">{op.name}</span>
                      <span className="cov-op-modes">
                        {op.modes.map((mode) => c.modes[mode]).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
