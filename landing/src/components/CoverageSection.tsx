import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  CableCar,
  Check,
  ChevronDown,
  Clock,
  MapPin,
  Megaphone,
  Minus,
  Radio,
  Search,
  TrainFront,
  X,
} from 'lucide-react';
import { RAIL_ICON_SPECS, type RailAgency } from '../../../src/services/railIconPaths';
import { useStrings, useWebLocale } from '../i18n';
import {
  COVERAGE_CITIES,
  filterCoveragePlaces,
  findMatchedAlias,
  normalizeCoverageQuery,
  type CoveragePlace,
  type OperatorEntry,
} from '../coverageData';
import { getCoverageStats, getCoverageStatsGeneratedAt } from '../coverageStats';
import { POLAND_OUTLINE, projectPolandPoint } from '../mapProjection';

const MAP_VIEWBOX_SIZE = 600;

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
    <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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

function OperatorLogo({ operator }: { operator: OperatorEntry }) {
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
        <CableCar size={18} strokeWidth={1.9} />
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
): { boxX: number; boxY: number; boxW: number; textX: number; textY: number } {
  const boxW = Math.max(76, Math.round(label.length * 7.6 + 24));
  const boxH = 26;
  const boxX = Math.max(10, Math.min(MAP_VIEWBOX_SIZE - boxW - 10, x - boxW / 2));
  const placeBelow = y < 48;
  const boxY = placeBelow ? y + 16 : y - boxH - 14;
  return {
    boxX,
    boxY,
    boxW,
    textX: boxX + boxW / 2,
    textY: boxY + 17,
  };
}

export function CoverageSection() {
  const s = useStrings();
  const c = s.coverage;
  const locale = useWebLocale();

  const statsDate = useMemo(() => {
    const raw = getCoverageStatsGeneratedAt();
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      date,
    );
  }, [locale]);

  const listboxId = useId();
  const inputId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const [selectedKey, setSelectedKey] = useState<string>('wroclaw');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const cityCount = COVERAGE_CITIES.length;

  const projectedCities = useMemo(
    () =>
      COVERAGE_CITIES.map((place) => {
        const pt = projectPolandPoint(place.lon, place.lat);
        return { place, x: pt.x, y: pt.y };
      }),
    [],
  );

  const orderedProjectedCities = useMemo(() => {
    return [...projectedCities].sort((a, b) => {
      const rank = (key: string) => (key === hoveredKey ? 2 : key === selectedKey ? 1 : 0);
      return rank(a.place.key) - rank(b.place.key);
    });
  }, [projectedCities, selectedKey, hoveredKey]);

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

  const selectedPlace: CoveragePlace = useMemo(
    () => COVERAGE_CITIES.find((place) => place.key === selectedKey) ?? COVERAGE_CITIES[0]!,
    [selectedKey],
  );

  const stats = getCoverageStats(selectedPlace.key);

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

  const activeOptionId =
    isOpen && activeIndex >= 0 && filteredCities[activeIndex]
      ? `${listboxId}-opt-${filteredCities[activeIndex]!.key}`
      : undefined;

  return (
    <section id="coverage" className="section-shell coverage-section reveal">
      <div className="cov-grid">
        <div className="cov-map-stage">
          <div className="cov-map-canvas">
            <svg
              className="cov-map-svg"
              viewBox={`0 0 ${MAP_VIEWBOX_SIZE} ${MAP_VIEWBOX_SIZE}`}
              role="img"
              aria-label={c.mapAria}
            >
              <path className="cov-poland-land" d={POLAND_OUTLINE} />

              {orderedProjectedCities.map(({ place, x, y }) => {
                const isSelected = place.key === selectedPlace.key;
                const isHovered = place.key === hoveredKey;
                const isDimmed = isSearching && !matchedKeys.has(place.key) && !isSelected;

                return (
                  <g
                    key={place.key}
                    className={`cov-pin${isSelected ? ' is-selected' : ''}${isHovered ? ' is-hovered' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                    transform={`translate(${x.toFixed(1)}, ${y.toFixed(1)})`}
                    role="button"
                    tabIndex={0}
                    aria-label={place.regionLabel ? `${place.name} (${place.regionLabel})` : place.name}
                    aria-pressed={isSelected}
                    onClick={() => selectPlace(place)}
                    onKeyDown={(e) => handlePinKeyDown(e, place)}
                    onMouseEnter={() => setHoveredKey(place.key)}
                    onMouseLeave={() => setHoveredKey((prev) => (prev === place.key ? null : prev))}
                    onFocus={() => setHoveredKey(place.key)}
                    onBlur={() => setHoveredKey((prev) => (prev === place.key ? null : prev))}
                  >
                    <circle className="cov-pin-hit" r={10} cx={0} cy={0} />
                    {isSelected && (
                      <>
                        <circle className="cov-pin-halo" r={15} cx={0} cy={0} />
                        <circle className="cov-pin-ring" r={10} cx={0} cy={0} />
                      </>
                    )}
                    <circle
                      className="cov-pin-dot"
                      r={isSelected ? 6 : isHovered ? 5.2 : 4}
                      cx={0}
                      cy={0}
                    />
                  </g>
                );
              })}

              {activeCalloutItem &&
                (() => {
                  const pos = computeCalloutPosition(
                    activeCalloutItem.x,
                    activeCalloutItem.y,
                    activeCalloutItem.place.name,
                  );
                  return (
                    <g className="cov-callout" pointerEvents="none" aria-hidden="true">
                      <rect x={pos.boxX} y={pos.boxY} width={pos.boxW} height={26} rx={13} />
                      <text x={pos.textX} y={pos.textY} textAnchor="middle">
                        {activeCalloutItem.place.name}
                      </text>
                    </g>
                  );
                })()}
            </svg>
          </div>

          <p className="cov-map-caption">
            <span className="cov-map-dot" aria-hidden="true" />
            <span>{c.mapHint(cityCount)}</span>
          </p>
        </div>

        <div className="cov-head">
          <p className="eyebrow">{c.eyebrow}</p>
          <h2>{c.title}</h2>
          <p className="section-body cov-body">{c.body(cityCount)}</p>

          <div className="cov-picker" ref={pickerRef}>
            <div className={`cov-combobox${isOpen ? ' is-open' : ''}`}>
              <Search className="cov-combobox-icon" size={18} strokeWidth={2} aria-hidden="true" />
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
                  <ChevronDown size={18} strokeWidth={2} aria-hidden="true" />
                </button>
              )}
            </div>

            {isOpen && (
              <div className="cov-popover" id={listboxId} role="listbox" aria-label={c.citiesListLabel}>
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
                    const secondary = matchedAlias && !aliasAlreadyShown
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
                        {isSelected && <Check size={16} strokeWidth={2.2} aria-hidden="true" />}
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
        </div>

        <div className="cov-spotlight" aria-live="polite">
          <div className="cov-spot-head">
            <h3>{selectedPlace.name}</h3>
            {selectedPlace.regionLabel && (
              <p className="cov-spot-sub">{selectedPlace.regionLabel}</p>
            )}
          </div>

          <div className="cov-spot-status">
            <div className={`cov-stat${stats.live.available ? ' is-on' : ' is-off'}`}>
              <span className="cov-stat-k">
                {stats.live.available ? (
                  <Radio size={15} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Clock size={15} strokeWidth={2} aria-hidden="true" />
                )}
                <span>{c.liveLabel}</span>
              </span>
              <span className="cov-stat-v">
                {stats.live.available ? (
                  <Check size={15} strokeWidth={2.3} aria-hidden="true" />
                ) : (
                  <Minus size={15} strokeWidth={2} aria-hidden="true" />
                )}
                <span>
                  {stats.live.available
                    ? c.liveValue(stats.live.vehicles)
                    : c.liveUnavailable}
                </span>
              </span>
            </div>

            <div className={`cov-stat${stats.news.available ? ' is-on' : ' is-off'}`}>
              <span className="cov-stat-k">
                <Megaphone size={15} strokeWidth={2} aria-hidden="true" />
                <span>{c.newsLabel}</span>
              </span>
              <span className="cov-stat-v">
                {stats.news.available ? (
                  <Check size={15} strokeWidth={2.3} aria-hidden="true" />
                ) : (
                  <Minus size={15} strokeWidth={2} aria-hidden="true" />
                )}
                <span>
                  {stats.news.available
                    ? selectedPlace.newsSource
                      ? `${c.newsAvailable} · ${selectedPlace.newsSource}`
                      : c.newsAvailable
                    : c.newsUnavailable}
                </span>
              </span>
            </div>

            <div className={`cov-stat${stats.stopHints.available ? ' is-on' : ' is-off'}`}>
              <span className="cov-stat-k">
                <MapPin size={15} strokeWidth={2} aria-hidden="true" />
                <span>{c.stopHintsLabel}</span>
              </span>
              <span className="cov-stat-v">
                {stats.stopHints.available ? (
                  <Check size={15} strokeWidth={2.3} aria-hidden="true" />
                ) : (
                  <Minus size={15} strokeWidth={2} aria-hidden="true" />
                )}
                <span>
                  {stats.stopHints.available
                    ? c.stopHintsValue(stats.stopHints.stops ?? 0)
                    : c.stopHintsUnavailable}
                </span>
              </span>
            </div>
          </div>

          {statsDate && <p className="cov-stats-note">{c.statsUpdated(statsDate)}</p>}

          <div className="cov-ops">
            <p className="cov-ops-label">{c.operatorsLabel}</p>
            <ul className="cov-ops-list">
              {selectedPlace.operators.map((op) => (
                <li key={op.id} className="cov-op-row">
                  <OperatorLogo operator={op} />
                  <span className="cov-op-name">{op.name}</span>
                  <span className="cov-op-modes">
                    {op.modes.map((mode) => c.modes[mode]).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {selectedPlace.railGateways.length > 0 && (
            <p className="cov-rail-note">
              <TrainFront size={15} strokeWidth={2} aria-hidden="true" />
              <span>{c.railGatewayNote(selectedPlace.railGateways.join(', '))}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
