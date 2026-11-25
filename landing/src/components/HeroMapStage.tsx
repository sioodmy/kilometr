import { useEffect, useRef } from 'react';
import type { HeroBasemapData, HeroBasemapLabel } from '../data/heroBasemapData';
import { HERO_MAP_DATA, type HeroPoint } from '../data/heroMapData';

type HeroMapStageProps = {
  originLabel: string;
  destinationLabel: string;
};

type NetworkSegment = {
  mode: 'tram' | 'bus';
  from: HeroPoint;
  to: HeroPoint;
  dFrom: number;
  dTo: number;
  dMid: number;
};

type StopRipple = {
  pt: HeroPoint;
  startedAt: number;
  isRoute: boolean;
};

const {
  width: MAP_W,
  height: MAP_H,
  origin,
  journeyLine,
  journeyWalk,
  journeyRide,
  journeyStops,
  stops,
  network,
} = HERO_MAP_DATA;

const DEST_PT = journeyStops[journeyStops.length - 1].pt;
const DIST_TO_DEST = Math.hypot(DEST_PT[0] - origin.pt[0], DEST_PT[1] - origin.pt[1]);
const ROUTE_MID: HeroPoint = [(origin.pt[0] + DEST_PT[0]) * 0.5, (origin.pt[1] + DEST_PT[1]) * 0.5];

type DecodedBasemap = {
  water: Float32Array[][];
  waterways: Float32Array[];
  parks: Float32Array[][];
  buildings: Float32Array[][];
  rail: Float32Array[];
  major: Float32Array[];
  medium: Float32Array[];
  minor: Float32Array[];
  bridges: Float32Array[];
  labels: readonly HeroBasemapLabel[];
};

function decodeCoords(encoded: string, invQ: number): Float32Array {
  const parts = encoded.split(',');
  const out = new Float32Array(parts.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const dx = Number(parts[i]);
    const dy = Number(parts[i + 1]);
    if (i === 0) {
      x = dx;
      y = dy;
    } else {
      x += dx;
      y += dy;
    }
    out[i] = x * invQ;
    out[i + 1] = y * invQ;
  }
  return out;
}

function decodeBasemap(data: HeroBasemapData): DecodedBasemap {
  const invQ = 1 / data.q;
  const decodeMultiPolys = (list: readonly string[]) =>
    list.map((item) => item.split('|').map((ring) => decodeCoords(ring, invQ)));
  const decodeLines = (list: readonly string[]) => list.map((line) => decodeCoords(line, invQ));
  return {
    water: decodeMultiPolys(data.water),
    waterways: decodeLines(data.waterways),
    parks: decodeMultiPolys(data.parks),
    buildings: decodeMultiPolys(data.buildings),
    rail: decodeLines(data.rail),
    major: decodeLines(data.major),
    medium: decodeLines(data.medium),
    minor: decodeLines(data.minor),
    bridges: decodeLines(data.bridges),
    labels: data.labels,
  };
}

let basemapPromise: Promise<DecodedBasemap> | null = null;
let cachedBasemap: DecodedBasemap | null = null;

function loadBasemap(): Promise<DecodedBasemap> {
  if (!basemapPromise) {
    basemapPromise = import('../data/heroBasemapData').then(({ HERO_BASEMAP_DATA }) => {
      cachedBasemap = decodeBasemap(HERO_BASEMAP_DATA);
      return cachedBasemap;
    });
  }
  return basemapPromise;
}

// Deduplikacja nakładających się odcinków GTFS (wiele linii na tej samej ulicy dawało
// nierówne, przepalone linie przy sumowaniu alpha; każda ulica rysuje się dokładnie raz).
function buildDeduplicatedSegments(): NetworkSegment[] {
  const cell = 3.2;
  const byKey = new Map<string, NetworkSegment>();

  // Tramwaje pierwsze, żeby na wspólnych ciągach zachować priorytet torowiska nad autobusem.
  const ordered = [
    ...network.filter((l) => l.mode === 'tram'),
    ...network.filter((l) => l.mode === 'bus'),
  ];

  for (const line of ordered) {
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1];
      const b = line.pts[i];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.8) continue;

      const ax = Math.round(a[0] / cell);
      const ay = Math.round(a[1] / cell);
      const bx = Math.round(b[0] / cell);
      const by = Math.round(b[1] / cell);
      const forward = ax < bx || (ax === bx && ay <= by);
      const key = forward ? `${ax},${ay}:${bx},${by}` : `${bx},${by}:${ax},${ay}`;
      if (byKey.has(key)) continue;

      const da = Math.hypot(a[0] - origin.pt[0], a[1] - origin.pt[1]);
      const db = Math.hypot(b[0] - origin.pt[0], b[1] - origin.pt[1]);
      byKey.set(
        key,
        da <= db
          ? { mode: line.mode, from: a, to: b, dFrom: da, dTo: db, dMid: (da + db) * 0.5 }
          : { mode: line.mode, from: b, to: a, dFrom: db, dTo: da, dMid: (da + db) * 0.5 },
      );
    }
  }
  return Array.from(byKey.values());
}

const SEGMENTS = buildDeduplicatedSegments();
const STOP_DISTS = stops.map(([x, y]) => Math.hypot(x - origin.pt[0], y - origin.pt[1]));

const RIDE_SEG_LENS: number[] = [];
let RIDE_TOTAL_LEN = 0;
for (let i = 1; i < journeyRide.length; i++) {
  const len = Math.hypot(
    journeyRide[i][0] - journeyRide[i - 1][0],
    journeyRide[i][1] - journeyRide[i - 1][1],
  );
  RIDE_SEG_LENS.push(len);
  RIDE_TOTAL_LEN += len;
}

function sampleRide(progress: number): { pt: HeroPoint; angle: number } {
  const target = Math.max(0, Math.min(1, progress)) * RIDE_TOTAL_LEN;
  let acc = 0;
  for (let i = 0; i < RIDE_SEG_LENS.length; i++) {
    const seg = RIDE_SEG_LENS[i];
    if (acc + seg >= target || i === RIDE_SEG_LENS.length - 1) {
      const local = seg > 0 ? (target - acc) / seg : 0;
      const a = journeyRide[i];
      const b = journeyRide[i + 1];
      return {
        pt: [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local],
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
      };
    }
    acc += seg;
  }
  return { pt: journeyRide[0], angle: 0 };
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - clamp01(x), 3);
}

function easeInOutCubic(x: number) {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq <= 0.0001) {
    const dx = px - ax;
    const dy = py - ay;
    return dx * dx + dy * dy;
  }
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / lenSq);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

const PARALLAX_PAD = 24;

// Renderuje statyczny podkład kartograficzny Wrocławia (woda z wyspami, parki, budynki,
// kolej, hierarchia ulic z casingiem, mosty, dzielnice) raz przy resize do offscreen canvas.
function renderBasemapCache(
  basemap: DecodedBasemap,
  width: number,
  height: number,
  dpr: number,
  scale: number,
): HTMLCanvasElement {
  const pad = PARALLAX_PAD;
  const bw = width + pad * 2;
  const bh = height + pad * 2;
  const off = document.createElement('canvas');
  off.width = Math.round(bw * dpr);
  off.height = Math.round(bh * dpr);
  const ctx = off.getContext('2d');
  if (!ctx) return off;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const midX = width * 0.5 + pad;
  const midY = (width >= 960 ? height * 0.45 : height * 0.46) + pad;
  const px = (mx: number) => midX + (mx - ROUTE_MID[0]) * scale;
  const py = (my: number) => midY + (my - ROUTE_MID[1]) * scale;

  // 1. Płaszczyzna lądu (ciemna paleta z src/map/mapStyle.ts)
  ctx.fillStyle = '#0d1411';
  ctx.fillRect(0, 0, bw, bh);

  const traceMultiPolys = (polys: Float32Array[][]) => {
    ctx.beginPath();
    for (let i = 0; i < polys.length; i++) {
      const rings = polys[i];
      for (let r = 0; r < rings.length; r++) {
        const pts = rings[r];
        if (pts.length < 6) continue;
        ctx.moveTo(px(pts[0]), py(pts[1]));
        for (let k = 2; k < pts.length; k += 2) {
          ctx.lineTo(px(pts[k]), py(pts[k + 1]));
        }
        ctx.closePath();
      }
    }
  };

  const traceLines = (lines: Float32Array[]) => {
    ctx.beginPath();
    for (let i = 0; i < lines.length; i++) {
      const pts = lines[i];
      if (pts.length < 4) continue;
      ctx.moveTo(px(pts[0]), py(pts[1]));
      for (let k = 2; k < pts.length; k += 2) {
        ctx.lineTo(px(pts[k]), py(pts[k + 1]));
      }
    }
  };

  // 2. Parki, zieleń miejska i wyspy zadrzewione (czysty fill bez stroke eliminuje szwy kafelkowe)
  traceMultiPolys(basemap.parks);
  ctx.fillStyle = '#14261d';
  ctx.fill('evenodd');

  // 3. Budynki i kwartały śródmieścia (prawdziwa tkanka urbanistyczna)
  traceMultiPolys(basemap.buildings);
  ctx.fillStyle = '#17221d';
  ctx.fill('evenodd');
  ctx.strokeStyle = '#21302a';
  ctx.lineWidth = 0.65;
  ctx.stroke();

  // 4. Cieki wodne (wąskie kanały, Fosa Miejska, Oława)
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  traceLines(basemap.waterways);
  ctx.strokeStyle = '#133c4b';
  ctx.lineWidth = Math.max(1.8, scale * 1.15);
  ctx.stroke();

  // 5. Poligony wody (Odra z wyciętymi wyspami; bez stroke żeby uniknąć szwów między kafelkami)
  for (let i = 0; i < basemap.water.length; i++) {
    const rings = basemap.water[i];
    ctx.beginPath();
    for (let r = 0; r < rings.length; r++) {
      const pts = rings[r];
      if (pts.length < 6) continue;
      ctx.moveTo(px(pts[0]), py(pts[1]));
      for (let k = 2; k < pts.length; k += 2) {
        ctx.lineTo(px(pts[k]), py(pts[k + 1]));
      }
      ctx.closePath();
    }
    ctx.fillStyle = '#113745';
    ctx.fill('evenodd');
  }

  // 6. Kolej (estakada kolejowa i Dworzec Główny)
  ctx.save();
  traceLines(basemap.rail);
  ctx.strokeStyle = '#070b09';
  ctx.lineWidth = Math.max(2.6, scale * 1.25);
  ctx.stroke();
  ctx.strokeStyle = '#263438';
  ctx.lineWidth = Math.max(1.25, scale * 0.58);
  ctx.stroke();
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = '#3b4e54';
  ctx.lineWidth = Math.max(1.0, scale * 0.45);
  ctx.stroke();
  ctx.restore();

  // 7. Hierarchia sieci drogowej (casing + równe wypełnienie każdej klasy)
  const minorCore = Math.max(1.15, Math.min(2.6, scale * 0.72));
  const mediumCore = Math.max(2.0, Math.min(4.2, scale * 1.22));
  const majorCore = Math.max(3.2, Math.min(6.4, scale * 1.85));

  // Ulice lokalne (minor)
  traceLines(basemap.minor);
  ctx.strokeStyle = '#090e0b';
  ctx.lineWidth = minorCore + 1.4;
  ctx.stroke();
  ctx.strokeStyle = '#1c2824';
  ctx.lineWidth = minorCore;
  ctx.stroke();

  // Ulice zbiorcze (tertiary)
  traceLines(basemap.medium);
  ctx.strokeStyle = '#080d0a';
  ctx.lineWidth = mediumCore + 2.0;
  ctx.stroke();
  ctx.strokeStyle = '#263631';
  ctx.lineWidth = mediumCore;
  ctx.stroke();

  // Główne arterie (primary, secondary, trunk)
  traceLines(basemap.major);
  ctx.strokeStyle = '#070b09';
  ctx.lineWidth = majorCore + 2.6;
  ctx.stroke();
  ctx.strokeStyle = '#344841';
  ctx.lineWidth = majorCore;
  ctx.stroke();

  // Mosty głównych arterii nad Odrą i Fosą (ta sama szerokość co ulica, mocniejszy casing)
  traceLines(basemap.bridges);
  ctx.strokeStyle = '#060a08';
  ctx.lineWidth = majorCore + 3.0;
  ctx.stroke();
  ctx.strokeStyle = '#3d544c';
  ctx.lineWidth = majorCore;
  ctx.stroke();

  // 8. Kartograficzna typografia (nazwy dzielnic i rzek z halo, bez kolizji z H1 i pinami)
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const oxScreen = px(origin.pt[0]);
  const oyScreen = py(origin.pt[1]);
  const dxScreen = px(DEST_PT[0]);
  const dyScreen = py(DEST_PT[1]);

  const drawLabel = ([name, mx, my, kind]: HeroBasemapLabel) => {
    const lx = px(mx);
    const ly = py(my);
    if (lx < pad + 32 || lx > width + pad - 32 || ly < pad + 24 || ly > height + pad - 24) return;
    if (kind === 0) {
      const inHeroHeadline =
        Math.abs(lx - (width * 0.5 + pad)) < Math.min(width * 0.3, 300) &&
        ly > height * 0.14 + pad &&
        ly < height * 0.48 + pad;
      if (inHeroHeadline) return;
      if (
        Math.hypot(lx - oxScreen, ly - oyScreen) < 68 ||
        Math.hypot(lx - dxScreen, ly - dyScreen) < 68
      ) {
        return;
      }
    }

    if (kind === 1) {
      ctx.font = 'italic 500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.strokeStyle = 'rgba(9, 14, 11, 0.9)';
      ctx.lineWidth = 3.2;
      ctx.strokeText(name, lx, ly);
      ctx.fillStyle = 'rgba(122, 192, 212, 0.64)';
      ctx.fillText(name, lx, ly);
    } else {
      ctx.font = '500 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.strokeStyle = 'rgba(9, 14, 11, 0.92)';
      ctx.lineWidth = 3.6;
      ctx.strokeText(name, lx, ly);
      ctx.fillStyle = 'rgba(164, 186, 174, 0.54)';
      ctx.fillText(name, lx, ly);
    }
  };

  for (let i = 0; i < basemap.labels.length; i++) {
    drawLabel(basemap.labels[i]);
  }
  ctx.restore();

  return off;
}

export function HeroMapStage({ originLabel, destinationLabel }: HeroMapStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let visible = true;
    let width = 1280;
    let height = 780;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let disposed = false;
    let basemapCanvas: HTMLCanvasElement | null = null;
    const startTime = performance.now();
    let lastFrameAt = startTime;

    // Stan interakcji kursora nad sekcją hero (tylko mysz i rysik, bez dotyku).
    let pointerActive = false;
    let pointerTargetX = width * 0.5;
    let pointerTargetY = height * 0.45;
    let pointerTargetFade = 0;
    let smoothX = pointerTargetX;
    let smoothY = pointerTargetY;
    let hoverAlpha = 0;
    let panX = 0;
    let panY = 0;
    let lastSnapKey: string | null = null;
    let lastRippleAt = 0;
    const lastRippleByStop = new Map<string, number>();
    const ripples: StopRipple[] = [];

    const getScale = () => {
      const cover = Math.max(width / MAP_W, height / MAP_H);
      if (width >= 960) return cover * 1.56;
      // Na wąskich ekranach dopasuj skalę tak, aby Sky Tower i Katedra mieściły się w kadrze.
      const fitRouteW = (width * 0.8) / Math.max(1, Math.abs(DEST_PT[0] - origin.pt[0]));
      return Math.max(cover * 0.92, Math.min(cover * 1.24, fitRouteW));
    };

    const rebuildBasemap = () => {
      if (!cachedBasemap) return;
      basemapCanvas = renderBasemapCache(cachedBasemap, width, height, dpr, getScale());
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(320, Math.round(rect.width));
      height = Math.max(460, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      rebuildBasemap();
    };

    const project = (pt: HeroPoint): [number, number] => {
      const scale = getScale();
      const targetMidX = width * 0.5 + panX;
      const targetMidY = (width >= 960 ? height * 0.45 : height * 0.46) + panY;
      return [
        targetMidX + (pt[0] - ROUTE_MID[0]) * scale,
        targetMidY + (pt[1] - ROUTE_MID[1]) * scale,
      ];
    };

    const unproject = (sx: number, sy: number): [number, number] => {
      const scale = getScale();
      const targetMidX = width * 0.5 + panX;
      const targetMidY = (width >= 960 ? height * 0.45 : height * 0.46) + panY;
      return [ROUTE_MID[0] + (sx - targetMidX) / scale, ROUTE_MID[1] + (sy - targetMidY) / scale];
    };

    const drawFrame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
      lastFrameAt = now;

      if (reduced.matches) {
        hoverAlpha = 0;
        panX = 0;
        panY = 0;
        ripples.length = 0;
      } else {
        const wasInactive = hoverAlpha < 0.01;
        const targetAlpha = pointerActive ? pointerTargetFade : 0;
        const alphaRate = pointerActive ? 7.5 : 4.2;
        hoverAlpha += (targetAlpha - hoverAlpha) * (1 - Math.exp(-dt * alphaRate));
        if (hoverAlpha < 0.002 && !pointerActive) hoverAlpha = 0;

        if (pointerActive) {
          if (wasInactive) {
            smoothX = pointerTargetX;
            smoothY = pointerTargetY;
          } else {
            const follow = 1 - Math.exp(-dt * 12);
            smoothX += (pointerTargetX - smoothX) * follow;
            smoothY += (pointerTargetY - smoothY) * follow;
          }
        }

        const allowParallax = width >= 768 && hoverAlpha > 0.002;
        const nx = allowParallax ? Math.max(-1, Math.min(1, (smoothX / width) * 2 - 1)) : 0;
        const ny = allowParallax ? Math.max(-1, Math.min(1, (smoothY / height) * 2 - 1)) : 0;
        const targetPanX = -nx * 11 * hoverAlpha;
        const targetPanY = -ny * 7 * hoverAlpha;
        const panFollow = 1 - Math.exp(-dt * 4.5);
        panX += (targetPanX - panX) * panFollow;
        panY += (targetPanY - panY) * panFollow;
        if (!pointerActive && Math.abs(panX) < 0.02 && Math.abs(panY) < 0.02) {
          panX = 0;
          panY = 0;
        }
      }

      const cycleSec = 14.0;
      const elapsed = reduced.matches ? 6.8 : ((now - startTime) / 1000) % cycleSec;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // 1. Blit zcache'owanego podkładu kartograficznego Wrocławia (60fps bez ponownego rysowania tysięcy ścieżek)
      if (basemapCanvas) {
        ctx.drawImage(
          basemapCanvas,
          panX - PARALLAX_PAD,
          panY - PARALLAX_PAD,
          width + PARALLAX_PAD * 2,
          height + PARALLAX_PAD * 2,
        );
      }

      const scale = getScale();
      const [ox, oy] = project(origin.pt);
      const [dx, dy] = project(DEST_PT);
      const lensRadius = width >= 960 ? 195 : 150;
      const hoverVisible = !reduced.matches && hoverAlpha > 0.005;
      const [mapCx, mapCy] = hoverVisible ? unproject(smoothX, smoothY) : [0, 0];

      let routeProximity = 0;
      let originProximity = 0;
      let destProximity = 0;
      if (hoverVisible) {
        let minRouteDistSq = Infinity;
        for (let i = 1; i < journeyRide.length; i++) {
          const a = journeyRide[i - 1];
          const b = journeyRide[i];
          const dSq = distSqToSegment(mapCx, mapCy, a[0], a[1], b[0], b[1]);
          if (dSq < minRouteDistSq) minRouteDistSq = dSq;
        }
        const routeDistPx = Math.sqrt(minRouteDistSq) * scale;
        routeProximity = easeOutCubic(clamp01(1 - routeDistPx / 105));
        originProximity = easeOutCubic(clamp01(1 - Math.hypot(smoothX - ox, smoothY - oy) / 115));
        destProximity = easeOutCubic(clamp01(1 - Math.hypot(smoothX - dx, smoothY - dy) / 115));
      }

      const cycleFade = elapsed > 12.2 ? Math.max(0, 1 - (elapsed - 12.2) / 1.5) : 1;
      const introFade = clamp01(elapsed / 0.45);
      const masterAlpha = reduced.matches ? 1 : introFade * cycleFade;

      const waveProgress = reduced.matches ? 1 : easeOutCubic(clamp01((elapsed - 0.35) / 4.2));
      const waveRadius = waveProgress * 680;
      const destHitT = reduced.matches ? 1 : clamp01((waveRadius - DIST_TO_DEST + 16) / 68);
      const routeDrawT = reduced.matches ? 1 : easeInOutCubic(clamp01((elapsed - 2.05) / 1.65));
      const networkCalm = 1 - routeDrawT * 0.45;

      // 2. Subtelna kartograficzna poświata pod kursorem
      if (hoverVisible) {
        const bloomR = lensRadius * 1.25;
        const hoverBg = ctx.createRadialGradient(smoothX, smoothY, 0, smoothX, smoothY, bloomR);
        hoverBg.addColorStop(0, `rgba(72, 198, 166, ${(0.07 * hoverAlpha).toFixed(4)})`);
        hoverBg.addColorStop(0.52, `rgba(34, 108, 90, ${(0.028 * hoverAlpha).toFixed(4)})`);
        hoverBg.addColorStop(1, 'rgba(9, 14, 11, 0)');
        ctx.fillStyle = hoverBg;
        ctx.fillRect(0, 0, width, height);
      }

      // 3. Soczewka kursora: podświetla zdeduplikowane korytarze tranzytowe w zasięgu kursora
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (hoverVisible) {
        const mapR = (lensRadius + 24) / scale;
        const minX = mapCx - mapR;
        const maxX = mapCx + mapR;
        const minY = mapCy - mapR;
        const maxY = mapCy + mapR;

        let hasTram = false;
        ctx.beginPath();
        for (const seg of SEGMENTS) {
          if (seg.mode !== 'tram') continue;
          if (
            (seg.from[0] < minX && seg.to[0] < minX) ||
            (seg.from[0] > maxX && seg.to[0] > maxX) ||
            (seg.from[1] < minY && seg.to[1] < minY) ||
            (seg.from[1] > maxY && seg.to[1] > maxY)
          ) {
            continue;
          }
          const [ax, ay] = project(seg.from);
          const [bx, by] = project(seg.to);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          hasTram = true;
        }
        if (hasTram) {
          const tramGrad = ctx.createRadialGradient(
            smoothX,
            smoothY,
            0,
            smoothX,
            smoothY,
            lensRadius,
          );
          tramGrad.addColorStop(0, `rgba(142, 240, 214, ${(0.46 * hoverAlpha).toFixed(4)})`);
          tramGrad.addColorStop(0.55, `rgba(92, 219, 190, ${(0.18 * hoverAlpha).toFixed(4)})`);
          tramGrad.addColorStop(1, 'rgba(92, 219, 190, 0)');
          ctx.strokeStyle = tramGrad;
          ctx.lineWidth = 2.0;
          ctx.stroke();
        }
      }

      // 4. Fala wyszukiwania RAPTOR rozchodząca się ze Sky Tower po zdeduplikowanych torowiskach
      if (waveRadius > 2 && masterAlpha > 0.01) {
        ctx.beginPath();
        for (const seg of SEGMENTS) {
          if (seg.dFrom >= waveRadius) continue;
          const t =
            seg.dTo <= waveRadius
              ? 1
              : (waveRadius - seg.dFrom) / Math.max(0.001, seg.dTo - seg.dFrom);
          const [ax, ay] = project(seg.from);
          const [bx, by] = project([
            seg.from[0] + (seg.to[0] - seg.from[0]) * t,
            seg.from[1] + (seg.to[1] - seg.from[1]) * t,
          ]);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.strokeStyle = `rgba(92, 219, 190, ${(0.28 * networkCalm * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 1.65;
        ctx.stroke();

        // Świetliste czoło fali na bieżąco odkrywanych korytarzach (jednolita grubość)
        if (!reduced.matches && waveProgress < 0.98) {
          for (const seg of SEGMENTS) {
            if (seg.dFrom >= waveRadius) continue;
            const distBehindFront = waveRadius - seg.dMid;
            if (distBehindFront < -18 || distBehindFront > 58) continue;
            const heat = Math.max(0, 1 - Math.abs(distBehindFront) / 52);
            if (heat < 0.1) continue;

            const t =
              seg.dTo <= waveRadius
                ? 1
                : (waveRadius - seg.dFrom) / Math.max(0.001, seg.dTo - seg.dFrom);
            const [ax, ay] = project(seg.from);
            const [bx, by] = project([
              seg.from[0] + (seg.to[0] - seg.from[0]) * t,
              seg.from[1] + (seg.to[1] - seg.from[1]) * t,
            ]);

            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.strokeStyle = `rgba(148, 245, 222, ${(heat * 0.56 * masterAlpha).toFixed(3)})`;
            ctx.lineWidth = 2.0 + heat * 0.7;
            ctx.stroke();
          }
        }
      }

      // 5. Przystanki na mapie budzące się przy przejściu fali
      if (waveRadius > 2 && masterAlpha > 0.01) {
        for (let i = 0; i < stops.length; i++) {
          const d = STOP_DISTS[i];
          if (d > waveRadius) continue;
          const delta = waveRadius - d;
          const flash = reduced.matches ? 0 : Math.max(0, 1 - delta / 68);
          const [sx, sy] = project(stops[i]);

          ctx.beginPath();
          ctx.arc(sx, sy, 1.5 + flash * 1.9, 0, Math.PI * 2);
          ctx.fillStyle =
            flash > 0.14
              ? `rgba(220, 255, 246, ${((0.3 + flash * 0.65) * masterAlpha).toFixed(3)})`
              : `rgba(116, 226, 198, ${(0.28 * networkCalm * masterAlpha).toFixed(3)})`;
          ctx.fill();
        }
      }

      // Przystanki budzące się pod kursorem oraz pierścień na najbliższym węźle.
      if (hoverVisible || ripples.length > 0) {
        const snapRadius = 68;
        let nearestPt: HeroPoint | null = null;
        let nearestDist = snapRadius;
        let nearestKey: string | null = null;
        let nearestIsRoute = false;

        if (hoverVisible) {
          for (let i = 0; i < stops.length; i++) {
            const pt = stops[i];
            const [sx, sy] = project(pt);
            const dist = Math.hypot(sx - smoothX, sy - smoothY);
            if (dist < lensRadius) {
              const falloff = Math.pow(1 - dist / lensRadius, 1.55);
              ctx.beginPath();
              ctx.arc(sx, sy, 1.35 + falloff * 1.9, 0, Math.PI * 2);
              ctx.fillStyle = `rgba(196, 252, 238, ${(0.6 * falloff * hoverAlpha).toFixed(3)})`;
              ctx.fill();
            }
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestPt = pt;
              nearestKey = `s:${i}`;
              nearestIsRoute = false;
            }
          }

          if (routeDrawT > 0.15 && masterAlpha > 0.1) {
            for (let i = 0; i < journeyStops.length; i++) {
              const stopThreshold = i / Math.max(1, journeyStops.length - 1);
              if (routeDrawT < stopThreshold) continue;
              const pt = journeyStops[i].pt;
              const [sx, sy] = project(pt);
              const dist = Math.hypot(sx - smoothX, sy - smoothY);
              if (dist < Math.min(snapRadius, nearestDist + 10)) {
                nearestDist = dist;
                nearestPt = pt;
                nearestKey = `r:${i}`;
                nearestIsRoute = true;
              }
            }
          }

          if (nearestPt && nearestKey && nearestKey !== lastSnapKey) {
            const lastForStop = lastRippleByStop.get(nearestKey) ?? 0;
            if (pointerActive && now - lastRippleAt > 140 && now - lastForStop > 1300) {
              ripples.push({ pt: nearestPt, startedAt: now, isRoute: nearestIsRoute });
              if (ripples.length > 5) ripples.shift();
              lastRippleAt = now;
              lastRippleByStop.set(nearestKey, now);
            }
            lastSnapKey = nearestKey;
          } else if (!nearestKey) {
            lastSnapKey = null;
          }
        }

        for (let i = ripples.length - 1; i >= 0; i--) {
          const ripple = ripples[i];
          const progress = (now - ripple.startedAt) / 680;
          if (progress >= 1) {
            ripples.splice(i, 1);
            continue;
          }
          const [rx, ry] = project(ripple.pt);
          const eased = easeOutCubic(progress);
          const alpha = (1 - progress) * (1 - progress) * 0.34;
          ctx.beginPath();
          ctx.arc(rx, ry, 5.5 + eased * 24, 0, Math.PI * 2);
          ctx.strokeStyle = ripple.isRoute
            ? `rgba(255, 194, 86, ${alpha.toFixed(3)})`
            : `rgba(148, 244, 218, ${alpha.toFixed(3)})`;
          ctx.lineWidth = 1.25;
          ctx.stroke();
        }

        if (hoverVisible && nearestPt) {
          const [nx, ny] = project(nearestPt);
          const snapStrength = easeOutCubic(clamp01(1 - nearestDist / snapRadius)) * hoverAlpha;
          if (snapStrength > 0.02) {
            ctx.beginPath();
            ctx.arc(nx, ny, 9.5 + snapStrength * 5.5, 0, Math.PI * 2);
            ctx.fillStyle = nearestIsRoute
              ? `rgba(255, 184, 58, ${(0.18 * snapStrength).toFixed(3)})`
              : `rgba(92, 219, 190, ${(0.14 * snapStrength).toFixed(3)})`;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(nx, ny, 4 + snapStrength * 1.4, 0, Math.PI * 2);
            ctx.fillStyle = '#090e0b';
            ctx.fill();
            ctx.lineWidth = 1.8;
            ctx.strokeStyle = nearestIsRoute
              ? `rgba(255, 196, 88, ${(0.92 * snapStrength).toFixed(3)})`
              : `rgba(142, 240, 212, ${(0.88 * snapStrength).toFixed(3)})`;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(nx, ny, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = nearestIsRoute
              ? `rgba(255, 246, 224, ${(0.95 * snapStrength).toFixed(3)})`
              : `rgba(232, 255, 248, ${(0.92 * snapStrength).toFixed(3)})`;
            ctx.fill();
          }
        }
      }

      // 6. Koncentryczny pierścień czoła fali startujący ze Sky Tower
      if (!reduced.matches && elapsed > 0.3 && waveProgress < 0.96 && masterAlpha > 0.01) {
        const ringAlpha = Math.sin(waveProgress * Math.PI) * 0.22 * masterAlpha;
        const rPx = waveRadius * scale;

        const waveGlow = ctx.createRadialGradient(ox, oy, Math.max(0, rPx - 52), ox, oy, rPx + 6);
        waveGlow.addColorStop(0, 'rgba(92, 219, 190, 0)');
        waveGlow.addColorStop(0.82, `rgba(92, 219, 190, ${(ringAlpha * 0.22).toFixed(3)})`);
        waveGlow.addColorStop(1, 'rgba(92, 219, 190, 0)');
        ctx.fillStyle = waveGlow;
        ctx.beginPath();
        ctx.arc(ox, oy, rPx + 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(ox, oy, rPx, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(182, 252, 234, ${(ringAlpha * 1.1).toFixed(3)})`;
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }

      // Puls punktu startowego Sky Tower
      if (masterAlpha > 0.01) {
        const originPulse = reduced.matches ? 0.35 : (Math.sin(now / 360) + 1) * 0.5;
        ctx.beginPath();
        ctx.arc(ox, oy, 11 + originPulse * 10, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(92, 219, 190, ${((0.24 - originPulse * 0.14) * masterAlpha).toFixed(3)})`;
        ctx.fill();
      }

      // Pierścień potwierdzenia celu przy Katedrze
      if (!reduced.matches && destHitT > 0.01 && destHitT < 0.99 && masterAlpha > 0.01) {
        const lockAlpha = (1 - destHitT) * 0.65 * masterAlpha;
        ctx.beginPath();
        ctx.arc(dx, dy, 8 + destHitT * 34, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 191, 71, ${lockAlpha.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 7. Główna wyznaczona trasa: Tramwaj 7 (Sky Tower -> Katedra)
      if (routeDrawT > 0.01 && masterAlpha > 0.01) {
        ctx.save();
        ctx.beginPath();
        journeyWalk.forEach((p, idx) => {
          const [pxPt, pyPt] = project(p);
          if (idx === 0) ctx.moveTo(pxPt, pyPt);
          else ctx.lineTo(pxPt, pyPt);
        });
        ctx.setLineDash([3.5, 5.5]);
        ctx.strokeStyle = `rgba(244, 249, 245, ${(0.86 * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 2.6;
        ctx.stroke();
        ctx.restore();

        const targetDist = routeDrawT * RIDE_TOTAL_LEN;
        const drawnPts: [number, number][] = [project(journeyRide[0])];
        let acc = 0;
        for (let i = 0; i < RIDE_SEG_LENS.length; i++) {
          const seg = RIDE_SEG_LENS[i];
          if (acc + seg <= targetDist) {
            drawnPts.push(project(journeyRide[i + 1]));
            acc += seg;
          } else {
            const local = seg > 0 ? (targetDist - acc) / seg : 0;
            const a = journeyRide[i];
            const b = journeyRide[i + 1];
            drawnPts.push(project([a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local]));
            break;
          }
        }

        const traceRoute = () => {
          ctx.beginPath();
          drawnPts.forEach(([pxPt, pyPt], idx) => {
            if (idx === 0) ctx.moveTo(pxPt, pyPt);
            else ctx.lineTo(pxPt, pyPt);
          });
        };

        const routeBoost = routeProximity * hoverAlpha;

        // Ciepła poświata pod trasą
        traceRoute();
        ctx.strokeStyle = `rgba(255, 179, 56, ${((0.22 + routeBoost * 0.14) * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 17 + routeBoost * 5;
        ctx.stroke();

        // Ciemna obwódka oddzielająca trasę od ulic i skrzyżowań
        traceRoute();
        ctx.strokeStyle = `rgba(8, 13, 10, ${(0.95 * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 9.5;
        ctx.stroke();

        // Rdzeń trasy (bursztyn Kilometra)
        traceRoute();
        ctx.strokeStyle = `rgba(255, 184, 58, ${(0.98 * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 4.6 + routeBoost * 0.55;
        ctx.stroke();

        // Wewnętrzny jasny rysunek osi
        traceRoute();
        ctx.strokeStyle = `rgba(255, 246, 224, ${(Math.min(1, 0.88 + routeBoost * 0.12) * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 1.4 + routeBoost * 0.35;
        ctx.stroke();

        // Przystanki pośrednie na trasie Tramwaju 7
        journeyStops.forEach((s, idx) => {
          const stopThreshold = idx / Math.max(1, journeyStops.length - 1);
          if (routeDrawT < stopThreshold) return;
          const [sx, sy] = project(s.pt);
          const isLast = idx === journeyStops.length - 1;
          const isFirst = idx === 0;
          ctx.beginPath();
          ctx.arc(sx, sy, isLast || isFirst ? 5.2 : 3.2, 0, Math.PI * 2);
          ctx.fillStyle = '#090e0b';
          ctx.fill();
          ctx.lineWidth = isLast || isFirst ? 2.6 : 1.8;
          ctx.strokeStyle = isLast
            ? `rgba(255, 196, 86, ${(0.98 * masterAlpha).toFixed(3)})`
            : `rgba(255, 232, 186, ${(0.88 * masterAlpha).toFixed(3)})`;
          ctx.stroke();
        });

        // 8. Plakietka linii ("7") po otwartej lewej stronie korytarza
        const badgeAppear = clamp01((routeDrawT - 0.16) / 0.2) * masterAlpha;
        if (badgeAppear > 0.02) {
          const badgeSample = sampleRide(0.16);
          const [bx, by] = project(badgeSample.pt);
          const pillW = 46;
          const pillH = 24;
          const bpx = bx - 14 - pillW;
          const bpy = by - pillH * 0.5;

          ctx.save();
          ctx.globalAlpha = badgeAppear;

          ctx.beginPath();
          ctx.moveTo(bx - 4, by);
          ctx.lineTo(bpx + pillW, by);
          ctx.strokeStyle = 'rgba(255, 196, 86, 0.72)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
          ctx.shadowBlur = 14;
          ctx.shadowOffsetY = 4;
          ctx.fillStyle = '#ffb638';
          ctx.beginPath();
          ctx.roundRect(bpx, bpy, pillW, pillH, 8);
          ctx.fill();
          ctx.shadowColor = 'transparent';

          ctx.strokeStyle = 'rgba(255, 245, 214, 0.55)';
          ctx.lineWidth = 1;
          ctx.stroke();

          const gx = bpx + 10;
          const gy = bpy + 6;
          ctx.fillStyle = '#141008';
          ctx.beginPath();
          ctx.roundRect(gx, gy, 9.5, 10.5, 2.2);
          ctx.fill();
          ctx.fillStyle = '#ffb638';
          ctx.fillRect(gx + 1.6, gy + 1.8, 6.3, 4.2);
          ctx.fillRect(gx + 1.8, gy + 7.4, 2, 1.6);
          ctx.fillRect(gx + 5.7, gy + 7.4, 2, 1.6);
          ctx.strokeStyle = '#141008';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(gx + 2, gy + 12.2);
          ctx.lineTo(gx + 0.8, gy + 13.5);
          ctx.moveTo(gx + 7.5, gy + 12.2);
          ctx.lineTo(gx + 8.7, gy + 13.5);
          ctx.stroke();

          ctx.fillStyle = '#141008';
          ctx.font = '800 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText(journeyLine, bpx + 26, bpy + pillH * 0.5 + 0.5);
          ctx.restore();
        }

        // 9. Płynący punkt tramwaju na żywo wzdłuż trasy
        const vehiclePhase = reduced.matches ? 0.58 : clamp01((elapsed - 3.35) / 8.0);
        if (vehiclePhase > 0 && vehiclePhase < 1) {
          const headT = easeInOutCubic(vehiclePhase);
          const tailStart = Math.max(0, headT - 0.14);
          ctx.beginPath();
          const steps = 16;
          for (let s = 0; s <= steps; s++) {
            const p = tailStart + ((headT - tailStart) * s) / steps;
            const [tx, ty] = project(sampleRide(p).pt);
            if (s === 0) ctx.moveTo(tx, ty);
            else ctx.lineTo(tx, ty);
          }
          ctx.strokeStyle = `rgba(255, 248, 228, ${(0.78 * masterAlpha).toFixed(3)})`;
          ctx.lineWidth = 4.6;
          ctx.stroke();

          const { pt } = sampleRide(headT);
          const [vx, vy] = project(pt);

          const pulse = reduced.matches ? 0.45 : (Math.sin(now / 260) + 1) * 0.5;
          ctx.beginPath();
          ctx.arc(vx, vy, 12 + pulse * 8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 184, 58, ${((0.3 - pulse * 0.16) * masterAlpha).toFixed(3)})`;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(vx, vy, 5.8, 0, Math.PI * 2);
          ctx.fillStyle = '#fff9ec';
          ctx.fill();
          ctx.lineWidth = 2.4;
          ctx.strokeStyle = '#ffb638';
          ctx.stroke();
        }
      }

      // 10. Piny i etykiety początku (Sky Tower) i celu (Katedra)
      if (masterAlpha > 0.01) {
        ctx.beginPath();
        ctx.arc(ox, oy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#090e0b';
        ctx.fill();
        ctx.lineWidth = 2.8;
        ctx.strokeStyle = `rgba(92, 219, 190, ${(0.98 * masterAlpha).toFixed(3)})`;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(ox, oy, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(230, 255, 246, ${(0.95 * masterAlpha).toFixed(3)})`;
        ctx.fill();

        if (width >= 768) {
          const drawEndpointPill = (
            ex: number,
            ey: number,
            text: string,
            align: 'left' | 'right',
            dotColor: string,
            borderColor: string,
            alpha: number,
          ) => {
            if (alpha <= 0.02) return;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = '600 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            const padL = 22;
            const padR = 11;
            const textW = ctx.measureText(text).width;
            const boxW = textW + padL + padR;
            const boxH = 26;
            const bx = align === 'right' ? ex - boxW - 14 : ex + 14;
            const by = ey - boxH * 0.5;

            ctx.fillStyle = 'rgba(11, 17, 14, 0.9)';
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(bx, by, boxW, boxH, 999);
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(bx + 11.5, by + boxH * 0.5, 3.2, 0, Math.PI * 2);
            ctx.fillStyle = dotColor;
            ctx.fill();

            ctx.fillStyle = '#eef4ee';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, bx + padL, by + boxH * 0.5 + 0.5);
            ctx.restore();
          };

          drawEndpointPill(
            ox,
            oy,
            originLabel,
            'right',
            '#5cdbbe',
            `rgba(92, 219, 190, ${(0.42 + originProximity * hoverAlpha * 0.36).toFixed(3)})`,
            masterAlpha,
          );

          const destLabelAlpha = clamp01((destHitT - 0.1) / 0.55) * masterAlpha;
          drawEndpointPill(
            dx,
            dy,
            destinationLabel,
            'left',
            '#ffb638',
            `rgba(255, 184, 58, ${(0.48 + destProximity * hoverAlpha * 0.34).toFixed(3)})`,
            destLabelAlpha,
          );
        }
      }

      if (!reduced.matches && visible && !document.hidden) {
        raf = requestAnimationFrame(drawFrame);
      }
    };

    const start = () => {
      cancelAnimationFrame(raf);
      lastFrameAt = performance.now();
      raf = requestAnimationFrame(drawFrame);
    };

    // Nasłuch na całej sekcji hero, bo warstwa mapy ma pointer-events: none pod tekstem i nawigacją.
    const interactionHost = host.closest('.hero-release') ?? host.parentElement ?? host;

    const handlePointerMove = (event: Event) => {
      if (reduced.matches) return;
      const pe = event as PointerEvent;
      if (pe.pointerType === 'touch') return;
      const rect = host.getBoundingClientRect();
      const x = pe.clientX - rect.left;
      const y = pe.clientY - rect.top;
      if (x < -48 || x > rect.width + 48 || y < -48 || y > rect.height + 48) {
        pointerActive = false;
        return;
      }
      pointerTargetX = x;
      pointerTargetY = y;
      const fadeStart = rect.height * 0.78;
      const fadeEnd = rect.height * 1.02;
      pointerTargetFade =
        y <= fadeStart ? 1 : clamp01(1 - (y - fadeStart) / Math.max(1, fadeEnd - fadeStart));
      pointerActive = pointerTargetFade > 0.01;
    };

    const clearPointer = () => {
      pointerActive = false;
      pointerTargetFade = 0;
    };

    const handleVisibility = () => {
      if (document.hidden) {
        clearPointer();
        cancelAnimationFrame(raf);
      } else if (visible) {
        start();
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !document.hidden) start();
        else {
          clearPointer();
          cancelAnimationFrame(raf);
        }
      },
      { threshold: 0.01 },
    );

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (reduced.matches || !visible) drawFrame(performance.now());
    });

    resize();
    if (!cachedBasemap) {
      void loadBasemap().then(() => {
        if (disposed) return;
        rebuildBasemap();
        if (reduced.matches || !visible) drawFrame(performance.now());
      });
    }
    observer.observe(host);
    resizeObserver.observe(host);
    interactionHost.addEventListener('pointermove', handlePointerMove, { passive: true });
    interactionHost.addEventListener('pointerleave', clearPointer);
    window.addEventListener('blur', clearPointer);
    document.addEventListener('visibilitychange', handleVisibility);
    reduced.addEventListener('change', start);
    start();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      resizeObserver.disconnect();
      interactionHost.removeEventListener('pointermove', handlePointerMove);
      interactionHost.removeEventListener('pointerleave', clearPointer);
      window.removeEventListener('blur', clearPointer);
      document.removeEventListener('visibilitychange', handleVisibility);
      reduced.removeEventListener('change', start);
    };
  }, [originLabel, destinationLabel]);

  return (
    <div className="hero-map-stage" ref={hostRef} aria-hidden="true">
      <canvas ref={canvasRef} className="hero-map-canvas" />
      <div className="hero-map-scrim" />
    </div>
  );
}
