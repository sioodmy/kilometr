import poland from './data/poland.json';

function mercator(lon: number, lat: number) {
  const radians = Math.PI / 180;
  return { x: lon * radians, y: -Math.log(Math.tan(Math.PI / 4 + (lat * radians) / 2)) };
}

const rings = poland.coordinates.map((ring) => ring.map(([lon, lat]) => mercator(lon, lat)));
const points = rings.flat();
const minX = Math.min(...points.map((point) => point.x));
const maxX = Math.max(...points.map((point) => point.x));
const minY = Math.min(...points.map((point) => point.y));
const maxY = Math.max(...points.map((point) => point.y));
const scale = 544 / Math.max(maxX - minX, maxY - minY);
const offsetX = (600 - (maxX - minX) * scale) / 2;
const offsetY = (600 - (maxY - minY) * scale) / 2;

function fit(point: { x: number; y: number }) {
  return { x: (point.x - minX) * scale + offsetX, y: (point.y - minY) * scale + offsetY };
}

export function projectPolandPoint(lon: number, lat: number) {
  return fit(mercator(lon, lat));
}

export const POLAND_OUTLINE = rings
  .map(
    (ring) =>
      ring
        .map((point, index) => {
          const p = fit(point);
          return `${index === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`;
        })
        .join('') + 'Z',
  )
  .join('');
