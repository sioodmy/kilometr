import { useState } from 'react';
import { Check, MapPin } from 'lucide-react';
import { CITIES, type CityId } from '../../../src/cities';
import { useStrings } from '../i18n';
import { POLAND_OUTLINE, projectPolandPoint } from '../mapProjection';

export function Coverage() {
  const s = useStrings().coverage;
  const [selectedId, setSelectedId] = useState<CityId>('warszawa');
  const selected = CITIES.find((city) => city.id === selectedId)!;
  const selectedPoint = projectPolandPoint(selected.center.lon, selected.center.lat);
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
            <path className="map-outline" d={POLAND_OUTLINE} fillRule="evenodd" />
            {CITIES.map((city) => {
              const p = projectPolandPoint(city.center.lon, city.center.lat);
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
