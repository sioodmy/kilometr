import { useEffect, useRef } from 'react';
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

// Precompute individual segments oriented outward from origin.pt so the route-search wave
// expands strictly along real corridors from Sky Tower without chord-jump artifacts.
const SEGMENTS: NetworkSegment[] = [];
for (const line of network) {
  for (let i = 1; i < line.pts.length; i++) {
    const a = line.pts[i - 1];
    const b = line.pts[i];
    const da = Math.hypot(a[0] - origin.pt[0], a[1] - origin.pt[1]);
    const db = Math.hypot(b[0] - origin.pt[0], b[1] - origin.pt[1]);
    if (da <= db) {
      SEGMENTS.push({
        mode: line.mode,
        from: a,
        to: b,
        dFrom: da,
        dTo: db,
        dMid: (da + db) * 0.5,
      });
    } else {
      SEGMENTS.push({
        mode: line.mode,
        from: b,
        to: a,
        dFrom: db,
        dTo: da,
        dMid: (da + db) * 0.5,
      });
    }
  }
}

const STOP_DISTS = stops.map(([x, y]) => Math.hypot(x - origin.pt[0], y - origin.pt[1]));

// Precompute cumulative arc length along the real Sky Tower -> Katedra ride path.
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

// Oder river channel flowing north-west through central Wroclaw in normalized map coords.
const ODER_CHANNEL: readonly HeroPoint[] = [
  [995, 290],
  [880, 265],
  [765, 240],
  [665, 205],
  [575, 198],
  [480, 212],
  [380, 196],
  [275, 165],
  [160, 130],
  [35, 95],
];

const ODER_BRANCH: readonly HeroPoint[] = [
  [765, 240],
  [670, 250],
  [585, 232],
  [480, 212],
];

// Route midpoint in map coordinates for deliberate hero framing.
const ROUTE_MID: HeroPoint = [
  (origin.pt[0] + DEST_PT[0]) * 0.5,
  (origin.pt[1] + DEST_PT[1]) * 0.5,
];

/**
 * Full-bleed dark city transit canvas:
 * 1. Search wave originates strictly from the start stop (Sky Tower) and branches outward
 *    along real Wroclaw GTFS corridors.
 * 2. When the wavefront reaches Katedra, the optimal route locks in and draws boldly in
 *    high-contrast transit amber with obsidian casing and a Kilometr line badge.
 */
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
    const startTime = performance.now();

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(320, Math.round(rect.width));
      height = Math.max(460, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    };

    // Frame central Wroclaw so Sky Tower sits on the open lower-left flank and Katedra
    // rises into the open upper-right flank, sweeping cleanly behind the centered headline.
    const getScale = () => {
      const cover = Math.max(width / MAP_W, height / MAP_H);
      const zoom = width >= 960 ? 1.66 : 1.24;
      return cover * zoom;
    };

    const project = (pt: HeroPoint): [number, number] => {
      const scale = getScale();
      const targetMidX = width * 0.5;
      const targetMidY = width >= 960 ? height * 0.45 : height * 0.46;
      return [
        targetMidX + (pt[0] - ROUTE_MID[0]) * scale,
        targetMidY + (pt[1] - ROUTE_MID[1]) * scale,
      ];
    };

    const drawFrame = (now: number) => {
      const cycleSec = 14.0;
      const elapsed = reduced.matches ? 6.8 : ((now - startTime) / 1000) % cycleSec;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const scale = getScale();
      const [ox, oy] = project(origin.pt);
      const [dx, dy] = project(DEST_PT);

      // Cycle choreography:
      // 0.0 - 0.55s : Origin beacon charges at Sky Tower
      // 0.35 - 4.4s : Outward search wavefront expands strictly from Sky Tower (reaches Katedra ~2.1s)
      // 2.05 - 3.65s: Optimal Tram 7 route locks in and draws from Sky Tower -> Katedra
      // 3.5 - 11.4s : Live tram glides along the amber route
      // 12.2 - 14.0s: Clean atmospheric dissolve before next calculation pass
      const cycleFade = elapsed > 12.2 ? Math.max(0, 1 - (elapsed - 12.2) / 1.5) : 1;
      const introFade = clamp01(elapsed / 0.45);
      const masterAlpha = reduced.matches ? 1 : introFade * cycleFade;

      const waveProgress = reduced.matches ? 1 : easeOutCubic(clamp01((elapsed - 0.35) / 4.2));
      const waveRadius = waveProgress * 680;
      const destHitT = reduced.matches
        ? 1
        : clamp01((waveRadius - DIST_TO_DEST + 16) / 68);
      const routeDrawT = reduced.matches
        ? 1
        : easeInOutCubic(clamp01((elapsed - 2.05) / 1.65));

      // Calm the explored background once the winning route locks in so the route dominates.
      const networkCalm = 1 - routeDrawT * 0.38;

      // 1. Subtle deep cartographic depth centered on the origin-to-destination corridor
      const bgGrad = ctx.createRadialGradient(
        (ox + dx) * 0.5,
        (oy + dy) * 0.5,
        24,
        (ox + dx) * 0.5,
        (oy + dy) * 0.5,
        Math.max(width, height) * 0.68,
      );
      bgGrad.addColorStop(0, 'rgba(18, 38, 31, 0.42)');
      bgGrad.addColorStop(0.55, 'rgba(11, 19, 15, 0.2)');
      bgGrad.addColorStop(1, 'rgba(9, 14, 11, 0)');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Oder river channel (crisp dark water silhouette, no synthetic diagonal grid)
      const drawRiver = (pts: readonly HeroPoint[], riverW: number) => {
        ctx.save();
        ctx.beginPath();
        pts.forEach((p, idx) => {
          const [px, py] = project(p);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(18, 49, 59, 0.48)';
        ctx.lineWidth = riverW;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(72, 148, 166, 0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      };
      drawRiver(ODER_CHANNEL, Math.max(14, scale * 11));
      drawRiver(ODER_BRANCH, Math.max(8, scale * 6.5));

      // 3. Base dormant transit network (ultra-subtle context before wave reaches it)
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const seg of SEGMENTS) {
        if (seg.mode !== 'bus') continue;
        const [ax, ay] = project(seg.from);
        const [bx, by] = project(seg.to);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.strokeStyle = 'rgba(116, 158, 178, 0.065)';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      ctx.beginPath();
      for (const seg of SEGMENTS) {
        if (seg.mode !== 'tram') continue;
        const [ax, ay] = project(seg.from);
        const [bx, by] = project(seg.to);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.strokeStyle = 'rgba(84, 178, 156, 0.1)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // 4. Outward route-calculation wave expanding segment-by-segment strictly from Sky Tower
      if (waveRadius > 2 && masterAlpha > 0.01) {
        // Settled explored corridors (batched for crisp 60fps performance)
        ctx.beginPath();
        for (const seg of SEGMENTS) {
          if (seg.dFrom >= waveRadius) continue;
          const t = seg.dTo <= waveRadius ? 1 : (waveRadius - seg.dFrom) / Math.max(0.001, seg.dTo - seg.dFrom);
          const [ax, ay] = project(seg.from);
          const [bx, by] = project([
            seg.from[0] + (seg.to[0] - seg.from[0]) * t,
            seg.from[1] + (seg.to[1] - seg.from[1]) * t,
          ]);
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
        }
        ctx.strokeStyle = `rgba(92, 219, 190, ${(0.2 * networkCalm * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 1.45;
        ctx.stroke();

        // Luminous active wavefront edge (segments currently being discovered by the search wave)
        if (!reduced.matches && waveProgress < 0.98) {
          for (const seg of SEGMENTS) {
            if (seg.dFrom >= waveRadius) continue;
            const distBehindFront = waveRadius - seg.dMid;
            if (distBehindFront < -20 || distBehindFront > 64) continue;
            const heat = Math.max(0, 1 - Math.abs(distBehindFront) / 56);
            if (heat < 0.08) continue;

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
            ctx.strokeStyle =
              seg.mode === 'tram'
                ? `rgba(148, 245, 222, ${(heat * 0.62 * masterAlpha).toFixed(3)})`
                : `rgba(168, 212, 240, ${(heat * 0.34 * masterAlpha).toFixed(3)})`;
            ctx.lineWidth = seg.mode === 'tram' ? 1.8 + heat * 1.4 : 1.3 + heat * 0.8;
            ctx.stroke();
          }
        }
      }

      // 5. Stop nodes pulsing softly as the origin search wave crosses them
      if (waveRadius > 2 && masterAlpha > 0.01) {
        for (let i = 0; i < stops.length; i++) {
          const d = STOP_DISTS[i];
          if (d > waveRadius) continue;
          const delta = waveRadius - d;
          const flash = reduced.matches ? 0 : Math.max(0, 1 - delta / 72);
          const [sx, sy] = project(stops[i]);

          ctx.beginPath();
          ctx.arc(sx, sy, 1.35 + flash * 2.2, 0, Math.PI * 2);
          ctx.fillStyle =
            flash > 0.12
              ? `rgba(220, 255, 246, ${((0.24 + flash * 0.68) * masterAlpha).toFixed(3)})`
              : `rgba(92, 219, 190, ${(0.22 * networkCalm * masterAlpha).toFixed(3)})`;
          ctx.fill();
        }
      }

      // 6. Clean concentric search wavefront rings originating strictly at Sky Tower
      if (!reduced.matches && elapsed > 0.3 && waveProgress < 0.96 && masterAlpha > 0.01) {
        const ringAlpha = Math.sin(waveProgress * Math.PI) * 0.24 * masterAlpha;
        const rPx = waveRadius * scale;

        // Soft radial wash right behind the expanding frontier
        const waveGlow = ctx.createRadialGradient(ox, oy, Math.max(0, rPx - 56), ox, oy, rPx + 6);
        waveGlow.addColorStop(0, 'rgba(92, 219, 190, 0)');
        waveGlow.addColorStop(0.82, `rgba(92, 219, 190, ${(ringAlpha * 0.24).toFixed(3)})`);
        waveGlow.addColorStop(1, 'rgba(92, 219, 190, 0)');
        ctx.fillStyle = waveGlow;
        ctx.beginPath();
        ctx.arc(ox, oy, rPx + 6, 0, Math.PI * 2);
        ctx.fill();

        // Hairline wavefront ring
        ctx.beginPath();
        ctx.arc(ox, oy, rPx, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(182, 252, 234, ${(ringAlpha * 1.15).toFixed(3)})`;
        ctx.lineWidth = 1.35;
        ctx.stroke();
      }

      // Origin start pulse (always clearly marks where calculation starts)
      if (masterAlpha > 0.01) {
        const originPulse = reduced.matches ? 0.35 : (Math.sin(now / 360) + 1) * 0.5;
        ctx.beginPath();
        ctx.arc(ox, oy, 11 + originPulse * 10, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(92, 219, 190, ${((0.24 - originPulse * 0.14) * masterAlpha).toFixed(3)})`;
        ctx.fill();
      }

      // Target-lock confirmation ripple at Katedra the instant the wavefront hits it
      if (!reduced.matches && destHitT > 0.01 && destHitT < 0.99 && masterAlpha > 0.01) {
        const lockAlpha = (1 - destHitT) * 0.65 * masterAlpha;
        ctx.beginPath();
        ctx.arc(dx, dy, 8 + destHitT * 34, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 191, 71, ${lockAlpha.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 7. Highlighted Optimal Route: Sky Tower -> Katedra (vivid transit amber + obsidian casing)
      if (routeDrawT > 0.01 && masterAlpha > 0.01) {
        // Crisp dashed walk lead-in from Sky Tower to Wielka stop
        ctx.save();
        ctx.beginPath();
        journeyWalk.forEach((p, idx) => {
          const [px, py] = project(p);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.setLineDash([3.5, 5.5]);
        ctx.strokeStyle = `rgba(244, 249, 245, ${(0.82 * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 2.6;
        ctx.stroke();
        ctx.restore();

        // Build partial ride polyline up to routeDrawT
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
          drawnPts.forEach(([px, py], idx) => {
            if (idx === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          });
        };

        // Soft warm amber glow halo
        traceRoute();
        ctx.strokeStyle = `rgba(255, 179, 56, ${(0.24 * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 18;
        ctx.stroke();

        // Dark obsidian casing so crossing background transit lines never muddy the route
        traceRoute();
        ctx.strokeStyle = `rgba(8, 13, 10, ${(0.92 * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 9.5;
        ctx.stroke();

        // Vivid high-contrast transit amber core (separates instantly from teal/slate network)
        traceRoute();
        ctx.strokeStyle = `rgba(255, 184, 58, ${(0.98 * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 4.4;
        ctx.stroke();

        // Razor-sharp inner champagne highlight
        traceRoute();
        ctx.strokeStyle = `rgba(255, 246, 224, ${(0.88 * masterAlpha).toFixed(3)})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // Route stops along Tram 7
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

        // 8. Kilometr-style Line Badge ("7") anchored on the open left-flank corridor (zero text collision)
        const badgeAppear = clamp01((routeDrawT - 0.16) / 0.2) * masterAlpha;
        if (badgeAppear > 0.02) {
          const badgeSample = sampleRide(0.16);
          const [bx, by] = project(badgeSample.pt);
          const pillW = 46;
          const pillH = 24;
          const px = bx - 14 - pillW;
          const py = by - pillH * 0.5;

          ctx.save();
          ctx.globalAlpha = badgeAppear;

          // Thin leader tick connecting route to line badge
          ctx.beginPath();
          ctx.moveTo(bx - 4, by);
          ctx.lineTo(px + pillW, by);
          ctx.strokeStyle = 'rgba(255, 196, 86, 0.72)';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // Obsidian drop halo + vivid amber Kilometr pill
          ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
          ctx.shadowBlur = 14;
          ctx.shadowOffsetY = 4;
          ctx.fillStyle = '#ffb638';
          ctx.beginPath();
          ctx.roundRect(px, py, pillW, pillH, 8);
          ctx.fill();
          ctx.shadowColor = 'transparent';

          ctx.strokeStyle = 'rgba(255, 245, 214, 0.55)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Crisp minimalist tram glyph inside left half of badge
          const gx = px + 10;
          const gy = py + 6;
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

          // Bold line number
          ctx.fillStyle = '#141008';
          ctx.font = '800 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText(journeyLine, px + 26, py + pillH * 0.5 + 0.5);
          ctx.restore();
        }

        // 9. Gliding live tram beacon with luminous tail along the amber route
        const vehiclePhase = reduced.matches
          ? 0.58
          : clamp01((elapsed - 3.35) / 8.0);
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

      // 10. Crisp Origin (Sky Tower) & Destination (Katedra) pins + desktop pills
      if (masterAlpha > 0.01) {
        // Start node (always visible as calculation origin)
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
            px: number,
            py: number,
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
            const bx = align === 'right' ? px - boxW - 14 : px + 14;
            const by = py - boxH * 0.5;

            ctx.fillStyle = 'rgba(11, 17, 14, 0.88)';
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(bx, by, boxW, boxH, 999);
            ctx.fill();
            ctx.stroke();

            // Status dot inside pill
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
            'rgba(92, 219, 190, 0.42)',
            masterAlpha,
          );

          const destLabelAlpha = clamp01((destHitT - 0.1) / 0.55) * masterAlpha;
          drawEndpointPill(
            dx,
            dy,
            destinationLabel,
            'left',
            '#ffb638',
            'rgba(255, 184, 58, 0.48)',
            destLabelAlpha,
          );
        }
      }

      if (!reduced.matches && visible) {
        raf = requestAnimationFrame(drawFrame);
      }
    };

    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(drawFrame);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else cancelAnimationFrame(raf);
      },
      { threshold: 0.01 },
    );

    const resizeObserver = new ResizeObserver(() => {
      resize();
      if (reduced.matches || !visible) drawFrame(performance.now());
    });

    resize();
    observer.observe(host);
    resizeObserver.observe(host);
    reduced.addEventListener('change', start);
    start();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      resizeObserver.disconnect();
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
