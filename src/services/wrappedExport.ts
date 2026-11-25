// Eksport prywatnej karty podsumowania ("Wrapped") do pliku PNG:
// - Android/iOS: zrzut komponentu przez react-native-view-shot + udostepnienie.
// - Web PWA: deterministyczny render HTML5 Canvas 1080x1350 + Web Share API lub download PNG.

import type { RefObject } from 'react';
import { Platform, type View } from 'react-native';
import type { LegMode } from '../types/models';
import type { WrappedSafeSummary } from './userStatsModel';

export type WrappedThemeId = 'emerald' | 'night' | 'rail';

export interface WrappedThemePalette {
  id: WrappedThemeId;
  bgTop: string;
  bgBottom: string;
  surface: string;
  surfaceBorder: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  ink: string;
  muted: string;
  trackStroke: string;
  modeColors: Record<LegMode, string>;
}

export const WRAPPED_THEMES: Record<WrappedThemeId, WrappedThemePalette> = {
  emerald: {
    id: 'emerald',
    bgTop: '#07221E',
    bgBottom: '#0D1716',
    surface: '#112E29',
    surfaceBorder: '#234F47',
    accent: '#5CDBBE',
    accentSoft: '#16463D',
    accentText: '#003831',
    ink: '#ECFAF6',
    muted: '#9EC2B9',
    trackStroke: '#1D5248',
    modeColors: {
      tram: '#5CDBBE',
      bus: '#88C8FF',
      train: '#FFB957',
      subway: '#B7B8FF',
      trolleybus: '#8EE09C',
      cable: '#FF9EB8',
      walk: '#9EC2B9',
    },
  },
  night: {
    id: 'night',
    bgTop: '#0C1429',
    bgBottom: '#111322',
    surface: '#17203B',
    surfaceBorder: '#2A3963',
    accent: '#96CCFF',
    accentSoft: '#223663',
    accentText: '#062642',
    ink: '#EEF4FF',
    muted: '#A3B4D6',
    trackStroke: '#253762',
    modeColors: {
      tram: '#71D8C2',
      bus: '#96CCFF',
      train: '#DAB9FF',
      subway: '#FFBE78',
      trolleybus: '#86DFB2',
      cable: '#FFAEDE',
      walk: '#A3B4D6',
    },
  },
  rail: {
    id: 'rail',
    bgTop: '#211912',
    bgBottom: '#131210',
    surface: '#2C2219',
    surfaceBorder: '#4A3A2B',
    accent: '#FFB957',
    accentSoft: '#4A3519',
    accentText: '#3A2300',
    ink: '#FBF5EC',
    muted: '#C8B8A4',
    trackStroke: '#4A3826',
    modeColors: {
      tram: '#71D8C2',
      bus: '#96CCFF',
      train: '#FFB957',
      subway: '#CBBEFF',
      trolleybus: '#97D77D',
      cable: '#FFB1C5',
      walk: '#C8B8A4',
    },
  },
};

export interface WrappedExportStrings {
  title: string;
  subtitle: string;
  distanceLabel: string;
  tripsLabel: string;
  timeLabel: string;
  railLabel: string;
  walkLabel: string;
  stopsLabel: string;
  citiesLabel: string;
  co2Label: string;
  modesTitle: string;
  archetypeLabel: string;
  footerNote: string;
  formatKm: (km: number) => string;
  formatDuration: (min: number) => string;
  formatMode: (mode: LegMode) => string;
  formatCo2: (kg: number) => string;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  ctx.save();
  roundRectPath(ctx, x, y, size, size, size * 0.24);
  ctx.fillStyle = '#00a884';
  ctx.fill();

  const scale = (size / 1024) * 0.82;
  ctx.translate(x + size / 2, y + size / 2);
  ctx.scale(scale, scale);
  ctx.translate(-512, -512);

  ctx.strokeStyle = '#04362c';
  ctx.lineWidth = 80;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  ctx.moveTo(352, 180);
  ctx.lineTo(352, 794);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(352, 512);
  ctx.bezierCurveTo(390, 380, 480, 300, 600, 220);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(352, 512);
  ctx.bezierCurveTo(400, 664, 510, 754, 672, 754);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(352, 512, 102, 0, Math.PI * 2);
  ctx.fillStyle = '#04362c';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(352, 512, 50, 0, Math.PI * 2);
  ctx.fillStyle = '#00a884';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(672, 754, 34, 0, Math.PI * 2);
  ctx.fillStyle = '#04362c';
  ctx.fill();
  ctx.restore();
}

async function renderWrappedCanvasBlob(
  summary: WrappedSafeSummary,
  themeId: WrappedThemeId,
  labels: WrappedExportStrings,
): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error('Canvas unavailable');
  }
  const palette = WRAPPED_THEMES[themeId];
  const width = 1080;
  const height = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  // Tlo z subtelnym pionowym gradientem
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, palette.bgTop);
  grad.addColorStop(1, palette.bgBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Schematyczne tory i przystanki w tle
  ctx.save();
  ctx.strokeStyle = palette.trackStroke;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(640, -20);
  ctx.bezierCurveTo(690, 220, 860, 290, 1110, 320);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(740, -20);
  ctx.bezierCurveTo(790, 260, 920, 390, 1110, 460);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-30, 1080);
  ctx.bezierCurveTo(220, 1040, 410, 1160, 560, 1380);
  ctx.stroke();

  for (const [cx, cy] of [
    [775, 195],
    [955, 292],
    [870, 336],
    [225, 1105],
  ]) {
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fillStyle = palette.bgTop;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = palette.accent;
    ctx.stroke();
  }
  ctx.restore();

  const pad = 76;
  const fontSans = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

  // Naglowek: marka + rok
  drawBrandMark(ctx, pad, 74, 68);
  ctx.fillStyle = palette.ink;
  ctx.font = `700 40px ${fontSans}`;
  ctx.fillText('Kilometr', pad + 88, 118);

  const yearText = String(summary.year);
  ctx.font = `700 32px ${fontSans}`;
  const yearWidth = ctx.measureText(yearText).width + 52;
  roundRectPath(ctx, width - pad - yearWidth, 80, yearWidth, 56, 28);
  ctx.fillStyle = palette.accentSoft;
  ctx.fill();
  ctx.fillStyle = palette.accent;
  ctx.textAlign = 'center';
  ctx.fillText(yearText, width - pad - yearWidth / 2, 119);
  ctx.textAlign = 'left';

  // Glowna metryka: przejechane kilometry
  ctx.fillStyle = palette.muted;
  ctx.font = `600 30px ${fontSans}`;
  ctx.fillText(labels.distanceLabel, pad, 240);

  ctx.fillStyle = palette.ink;
  ctx.font = `800 128px ${fontSans}`;
  ctx.fillText(labels.formatKm(summary.totalDistanceKm), pad, 376);

  // Archetyp pasazera
  ctx.font = `700 30px ${fontSans}`;
  const archW = Math.min(width - pad * 2, ctx.measureText(labels.archetypeLabel).width + 64);
  roundRectPath(ctx, pad, 418, archW, 64, 32);
  ctx.fillStyle = palette.accent;
  ctx.fill();
  ctx.fillStyle = palette.accentText;
  ctx.fillText(labels.archetypeLabel, pad + 32, 460);

  // Siatka 2x2 kafelkow KPI
  const cards: { label: string; value: string }[] = [
    { label: labels.tripsLabel, value: String(summary.totalTrips) },
    { label: labels.timeLabel, value: labels.formatDuration(summary.totalDurationMin) },
    summary.railTrips > 0
      ? {
          label: labels.railLabel,
          value:
            summary.railDistanceKm > 0
              ? labels.formatKm(summary.railDistanceKm)
              : String(summary.railTrips),
        }
      : { label: labels.stopsLabel, value: String(summary.totalStops || summary.citiesCount) },
    summary.totalWalkKm >= 0.5
      ? { label: labels.walkLabel, value: labels.formatKm(summary.totalWalkKm) }
      : { label: labels.co2Label, value: labels.formatCo2(summary.estimatedCo2SavedKg) },
  ];

  const gap = 24;
  const tileW = (width - pad * 2 - gap) / 2;
  const tileH = 186;
  const gridTop = 532;

  cards.forEach((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = pad + col * (tileW + gap);
    const y = gridTop + row * (tileH + gap);

    roundRectPath(ctx, x, y, tileW, tileH, 32);
    ctx.fillStyle = palette.surface;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = palette.surfaceBorder;
    ctx.stroke();

    ctx.fillStyle = palette.muted;
    ctx.font = `600 26px ${fontSans}`;
    ctx.fillText(card.label, x + 32, y + 60);

    ctx.fillStyle = palette.ink;
    ctx.font = `800 54px ${fontSans}`;
    ctx.fillText(card.value, x + 32, y + 136);
  });

  // Podzial srodkow transportu
  const modesTop = gridTop + tileH * 2 + gap + 42;
  roundRectPath(ctx, pad, modesTop, width - pad * 2, 232, 34);
  ctx.fillStyle = palette.surface;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.surfaceBorder;
  ctx.stroke();

  ctx.fillStyle = palette.muted;
  ctx.font = `600 26px ${fontSans}`;
  ctx.fillText(labels.modesTitle, pad + 32, modesTop + 56);

  const barX = pad + 32;
  const barY = modesTop + 82;
  const barW = width - pad * 2 - 64;
  const barH = 26;

  roundRectPath(ctx, barX, barY, barW, barH, 13);
  ctx.fillStyle = palette.bgBottom;
  ctx.fill();

  const activeModes = summary.modes.filter((m) => m.share > 0);
  let cursorX = barX;
  activeModes.forEach((m, index) => {
    const segW =
      index === activeModes.length - 1
        ? Math.max(12, barX + barW - cursorX)
        : Math.max(12, Math.round(barW * m.share) - 4);
    roundRectPath(ctx, cursorX, barY, segW, barH, 13);
    ctx.fillStyle = palette.modeColors[m.mode] ?? palette.accent;
    ctx.fill();
    cursorX += segW + 4;
  });

  let legendX = barX;
  const legendY = modesTop + 162;
  activeModes.slice(0, 4).forEach((m) => {
    const pct = Math.max(1, Math.round(m.share * 100));
    const text = `${labels.formatMode(m.mode)} ${pct}%`;
    ctx.beginPath();
    ctx.arc(legendX + 10, legendY - 10, 9, 0, Math.PI * 2);
    ctx.fillStyle = palette.modeColors[m.mode] ?? palette.accent;
    ctx.fill();

    ctx.fillStyle = palette.ink;
    ctx.font = `600 28px ${fontSans}`;
    ctx.fillText(text, legendX + 28, legendY);
    legendX += ctx.measureText(text).width + 58;
  });

  // Stopka
  ctx.fillStyle = palette.muted;
  ctx.font = `600 26px ${fontSans}`;
  ctx.fillText(labels.footerNote, pad, height - 68);
  ctx.textAlign = 'right';
  ctx.fillStyle = palette.accent;
  ctx.font = `700 28px ${fontSans}`;
  ctx.fillText('kilometr.app', width - pad, height - 68);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG encode failed'));
    }, 'image/png');
  });
}

function triggerWebDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function shareWrappedGraphic(params: {
  cardRef: RefObject<View | null>;
  summary: WrappedSafeSummary;
  themeId: WrappedThemeId;
  labels: WrappedExportStrings;
  saveOnly?: boolean;
}): Promise<void> {
  const { cardRef, summary, themeId, labels, saveOnly = false } = params;
  const filename = `kilometr-podsumowanie-${summary.year}.png`;

  if (Platform.OS === 'web') {
    const blob = await renderWrappedCanvasBlob(summary, themeId, labels);
    if (!saveOnly && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const file = new File([blob], filename, { type: 'image/png' });
      const canShareFiles =
        typeof navigator.canShare === 'function' ? navigator.canShare({ files: [file] }) : false;
      if (canShareFiles) {
        try {
          await navigator.share({ title: labels.title, files: [file] });
          return;
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
        }
      }
    }
    triggerWebDownload(blob, filename);
    return;
  }

  const { captureRef } = await import('react-native-view-shot');
  const data = await captureRef(cardRef, { format: 'png', result: 'base64', quality: 1 });

  if (saveOnly) {
    const FileSystem = await import('expo-file-system/legacy');
    const path = `${FileSystem.cacheDirectory ?? ''}${filename}`;
    await FileSystem.writeAsStringAsync(path, data, { encoding: FileSystem.EncodingType.Base64 });
    const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
    await Sharing.shareAsync(path, {
      mimeType: 'image/png',
      dialogTitle: labels.title,
      UTI: 'public.png',
    });
    return;
  }

  const { default: NativeShare } = await import('react-native-share');
  await NativeShare.open({
    title: labels.title,
    url: `data:image/png;base64,${data}`,
    type: 'image/png',
    filename: `kilometr-podsumowanie-${summary.year}`,
    useInternalStorage: true,
    failOnCancel: false,
  });
}
