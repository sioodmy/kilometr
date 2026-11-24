import { TrainFront } from 'lucide-react';
import { RAIL_ICON_SPECS, type RailIconSpec } from '../../../src/services/railIconPaths';
import { getRailAgencyColor } from '../../../src/services/railIdentity';
import './kilometrUi.css';

type RailIconKey = keyof typeof RAIL_ICON_SPECS;

function RailCarrierMark({
  agency,
  color = 'currentColor',
  size = 15,
}: {
  agency?: string;
  color?: string;
  size?: number;
}) {
  const key = agency?.toUpperCase();
  const spec: RailIconSpec | undefined =
    key && key in RAIL_ICON_SPECS ? RAIL_ICON_SPECS[key as RailIconKey] : undefined;
  if (!spec) {
    return <TrainFront size={size} strokeWidth={2.2} color={color} aria-hidden="true" />;
  }
  const scale = spec.scale ?? 1;
  const ty = spec.translateY ?? 0;
  const transform =
    scale !== 1 || ty !== 0
      ? `translate(${(12 * (1 - scale)).toFixed(2)} ${(12 * (1 - scale) + ty).toFixed(2)}) scale(${scale})`
      : undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      aria-hidden="true"
      className="km-rail-mark"
    >
      <g transform={transform}>
        {spec.paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}

const RAIL_CARRIERS: ReadonlyArray<{ code: RailIconKey; name: string }> = [
  { code: 'IC', name: 'PKP Intercity' },
  { code: 'PR', name: 'POLREGIO' },
  { code: 'KD', name: 'Koleje Dolnośląskie' },
  { code: 'KM', name: 'Koleje Mazowieckie' },
  { code: 'KMŁ', name: 'Koleje Małopolskie' },
  { code: 'KŚ', name: 'Koleje Śląskie' },
  { code: 'KW', name: 'Koleje Wielkopolskie' },
  { code: 'ŁKA', name: 'ŁKA' },
  { code: 'SKM', name: 'SKM' },
  { code: 'WKD', name: 'WKD' },
];

function RailCarrierChips({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul
      className={duplicate ? 'km-rail-marquee-group is-duplicate' : 'km-rail-marquee-group'}
      aria-hidden={duplicate || undefined}
    >
      {RAIL_CARRIERS.map(({ code, name }) => {
        const bg = getRailAgencyColor(code) ?? '#244B63';
        const darkText = code === 'KD' || code === 'KW';
        const fg = darkText ? '#111414' : '#FFFFFF';
        return (
          <li key={code} className="km-rail-chip">
            <span
              className="km-rail-chip-icon"
              style={{ backgroundColor: bg, color: fg }}
              aria-hidden="true"
            >
              <RailCarrierMark agency={code} color={fg} size={12} />
            </span>
            <span className="km-rail-chip-name">{name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function RailCarrierStrip({ label }: { label: string }) {
  return (
    <div className="km-rail-strip" role="region" aria-label={label}>
      <div className="km-rail-marquee">
        <div className="km-rail-marquee-track">
          <RailCarrierChips />
          <RailCarrierChips duplicate />
        </div>
      </div>
    </div>
  );
}

type CityCrestItem = {
  cityKey: string;
  name: string;
  src: string;
  width: number;
  height: number;
};

export const CITY_CRESTS: readonly CityCrestItem[] = [
  { cityKey: 'warszawa', name: 'Warszawa', src: './cities/warszawa.webp', width: 32, height: 56 },
  { cityKey: 'gzm', name: 'Metropolia GZM', src: './cities/gzm.webp', width: 47, height: 56 },
  { cityKey: 'krakow', name: 'Kraków', src: './cities/krakow.webp', width: 37, height: 56 },
  { cityKey: 'wroclaw', name: 'Wrocław', src: './cities/wroclaw.webp', width: 47, height: 56 },
  { cityKey: 'lodz', name: 'Łódź', src: './cities/lodz.webp', width: 44, height: 56 },
  { cityKey: 'poznan', name: 'Poznań', src: './cities/poznan.webp', width: 37, height: 56 },
  { cityKey: 'trojmiasto', name: 'Gdańsk', src: './cities/gdansk.webp', width: 47, height: 56 },
  { cityKey: 'szczecin', name: 'Szczecin', src: './cities/szczecin.webp', width: 43, height: 56 },
  { cityKey: 'lublin', name: 'Lublin', src: './cities/lublin.webp', width: 45, height: 56 },
  {
    cityKey: 'bydgoszcz',
    name: 'Bydgoszcz',
    src: './cities/bydgoszcz.webp',
    width: 46,
    height: 56,
  },
  {
    cityKey: 'bialystok',
    name: 'Białystok',
    src: './cities/bialystok.webp',
    width: 45,
    height: 56,
  },
  { cityKey: 'rzeszow', name: 'Rzeszów', src: './cities/rzeszow.webp', width: 45, height: 56 },
  { cityKey: 'torun', name: 'Toruń', src: './cities/torun.webp', width: 46, height: 56 },
  { cityKey: 'olsztyn', name: 'Olsztyn', src: './cities/olsztyn.webp', width: 45, height: 56 },
  { cityKey: 'kielce', name: 'Kielce', src: './cities/kielce.webp', width: 48, height: 56 },
  { cityKey: 'opole', name: 'Opole', src: './cities/opole.webp', width: 41, height: 56 },
];

function CityCrestChips({
  duplicate = false,
  selectedCityKey,
  onSelectCity,
}: {
  duplicate?: boolean;
  selectedCityKey?: string;
  onSelectCity?: (cityKey: string) => void;
}) {
  return (
    <ul
      className={duplicate ? 'km-rail-marquee-group is-duplicate' : 'km-rail-marquee-group'}
      aria-hidden={duplicate || undefined}
    >
      {CITY_CRESTS.map((city) => {
        const isSelected = selectedCityKey === city.cityKey;
        return (
          <li key={city.cityKey}>
            <button
              type="button"
              tabIndex={duplicate ? -1 : undefined}
              aria-pressed={!duplicate ? isSelected : undefined}
              className={
                isSelected ? 'km-rail-chip km-city-chip is-selected' : 'km-rail-chip km-city-chip'
              }
              onClick={() => onSelectCity?.(city.cityKey)}
            >
              <span className="km-city-crest-box" aria-hidden="true">
                <img
                  className="km-city-crest"
                  src={city.src}
                  alt=""
                  width={city.width}
                  height={city.height}
                  loading="lazy"
                  decoding="async"
                />
              </span>
              <span className="km-rail-chip-name">{city.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function CityCrestStrip({
  label,
  selectedCityKey,
  onSelectCity,
}: {
  label: string;
  selectedCityKey?: string;
  onSelectCity?: (cityKey: string) => void;
}) {
  return (
    <div className="km-rail-strip" role="region" aria-label={label}>
      <div className="km-rail-marquee">
        <div className="km-rail-marquee-track is-reverse">
          <CityCrestChips selectedCityKey={selectedCityKey} onSelectCity={onSelectCity} />
          <CityCrestChips duplicate selectedCityKey={selectedCityKey} onSelectCity={onSelectCity} />
        </div>
      </div>
    </div>
  );
}
