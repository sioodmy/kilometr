import { useState } from 'react';
import { Check, MapPin } from 'lucide-react';
import { CITIES, type CityId } from '../../../src/cities';
import { useStrings } from '../i18n';

// Granica: Natural Earth 1:110m, domena publiczna (naturalearthdata.com).
const boundary = [
  [23.484128, 53.912498],
  [23.527536, 53.470122],
  [23.804935, 53.089731],
  [23.799199, 52.691099],
  [23.199494, 52.486977],
  [23.508002, 52.023647],
  [23.527071, 51.578454],
  [24.029986, 50.705407],
  [23.922757, 50.424881],
  [23.426508, 50.308506],
  [22.51845, 49.476774],
  [22.776419, 49.027395],
  [22.558138, 49.085738],
  [21.607808, 49.470107],
  [20.887955, 49.328772],
  [20.415839, 49.431453],
  [19.825023, 49.217125],
  [19.320713, 49.571574],
  [18.909575, 49.435846],
  [18.853144, 49.49623],
  [18.392914, 49.988629],
  [17.649445, 50.049038],
  [17.554567, 50.362146],
  [16.868769, 50.473974],
  [16.719476, 50.215747],
  [16.176253, 50.422607],
  [16.238627, 50.697733],
  [15.490972, 50.78473],
  [15.016996, 51.106674],
  [14.607098, 51.745188],
  [14.685026, 52.089947],
  [14.4376, 52.62485],
  [14.074521, 52.981263],
  [14.353315, 53.248171],
  [14.119686, 53.757029],
  [14.8029, 54.050706],
  [16.363477, 54.513159],
  [17.622832, 54.851536],
  [18.620859, 54.682606],
  [18.696255, 54.438719],
  [19.66064, 54.426084],
  [20.892245, 54.312525],
  [22.731099, 54.327537],
  [23.243987, 54.220567],
];
const point = (lon: number, lat: number) => ({
  x: ((lon - 13.5) / 11) * 600,
  y: ((55.3 - lat) / 7) * 600,
});
const outline = boundary
  .map(([lon, lat]) => {
    const p = point(lon, lat);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  })
  .join(' ');

export function Coverage() {
  const s = useStrings().coverage;
  const [selectedId, setSelectedId] = useState<CityId>('warszawa');
  const selected = CITIES.find((city) => city.id === selectedId)!;
  const selectedPoint = point(selected.center.lon, selected.center.lat);
  return (
    <section id="zasieg" className="coverage section-shell">
      <div className="coverage-copy reveal">
        <p className="eyebrow">{s.eyebrow}</p>
        <h2>{s.title}</h2>
        <p className="section-body">{s.body}</p>
      </div>
      <div className="coverage-layout">
        <div className="coverage-options reveal">
          <p className="coverage-count">{s.count(CITIES.length)}</p>
          <div className="city-list" role="group" aria-label={s.label}>
            {[...CITIES]
              .sort((a, b) => s.cities[a.id].localeCompare(s.cities[b.id], 'pl'))
              .map((city) => (
                <button
                  key={city.id}
                  type="button"
                  aria-pressed={selectedId === city.id}
                  onClick={() => setSelectedId(city.id)}
                >
                  {s.cities[city.id]}
                  {selectedId === city.id && <Check size={15} aria-hidden="true" />}
                </button>
              ))}
          </div>
          <p className="coverage-note">{s.note}</p>
        </div>
        <div className="coverage-map reveal">
          <svg viewBox="0 0 600 600" role="img" aria-label={s.map}>
            <polygon points={outline} />
            {CITIES.map((city) => {
              const p = point(city.center.lon, city.center.lat);
              return (
                <circle
                  key={city.id}
                  cx={p.x}
                  cy={p.y}
                  r={city.id === selectedId ? 7 : 4}
                  className={city.id === selectedId ? 'map-selected' : 'map-city'}
                />
              );
            })}
            <circle cx={selectedPoint.x} cy={selectedPoint.y} r="18" className="map-ring" />
          </svg>
          <div className="city-detail" aria-live="polite" aria-atomic="true">
            <MapPin aria-hidden="true" />
            <div>
              <h3>{s.cities[selected.id]}</h3>
              {selected.id === 'gzm' && <p>{s.metro}</p>}
              <ul>
                <li>
                  <Check />
                  {s.timetable}
                </li>
                <li>
                  <Check />
                  {s.offline}
                </li>
                {selected.features.regionalRail && (
                  <li>
                    <Check />
                    {s.rail}
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
