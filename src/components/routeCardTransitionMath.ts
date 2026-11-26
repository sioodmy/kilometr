export interface TransitionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point2D {
  x: number;
  y: number;
}

interface DragShellFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  scale: number;
}

export type CardSurfaceVariant = 'default' | 'boarded' | 'longWalk' | 'past';

/** Minimalna szerokość strefy od lewej krawędzi aktywującej interaktywny gest wstecz. */
export const EDGE_BACK_ZONE_PX = 48;

/** Próg postępu przeciągnięcia, od którego puszczenie palca domyka ekran szczegółów. */
const DISMISS_PROGRESS_THRESHOLD = 0.24;

/** Próg prędkości poziomej (px/s), przy którym szybkie machnięcie domyka ekran wcześniej. */
const DISMISS_VELOCITY_X_FAST = 600;

/** Łączny próg dla średnio szybkiego ruchu palcem w prawo. */
const DISMISS_VELOCITY_X_MEDIUM = 320;
const DISMISS_PROGRESS_MEDIUM = 0.14;

/** Maksymalny scroll ekranu szczegółów, przy którym pasek linii nadal wraca jako wspólny element. */
export const MAX_SHARED_STRIP_RETURN_SCROLL_Y = 84;

/** Maksymalna rozbieżność wysokości lub szerokości, by uznać pomiar za wiarygodny. */
const MIN_RECT_DIMENSION = 24;

/** Przelicza prostokąt z układu okna na układ lokalny kontenera stosu tras. */
export function toRelativeRect(rect: TransitionRect, containerOrigin: Point2D): TransitionRect {
  return {
    x: rect.x - containerOrigin.x,
    y: rect.y - containerOrigin.y,
    width: rect.width,
    height: rect.height,
  };
}

/** Wylicza pozycję paska JourneyStrip w kontenerze na podstawie karty i lokalnego offsetu. */
export function computeStripRect(
  cardRect: TransitionRect,
  stripLocal: TransitionRect | null,
): TransitionRect | null {
  if (!stripLocal || stripLocal.width < MIN_RECT_DIMENSION || stripLocal.height < 16) {
    return null;
  }
  return {
    x: cardRect.x + stripLocal.x,
    y: cardRect.y + stripLocal.y,
    width: stripLocal.width,
    height: stripLocal.height,
  };
}

/** Sprawdza, czy zmierzony prostokąt karty mieści się sensownie w widocznym oknie listy. */
export function isValidTransitionRect(
  rect: TransitionRect | null | undefined,
  containerWidth: number,
  containerHeight: number,
): rect is TransitionRect {
  if (!rect) return false;
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    return false;
  }
  if (rect.width < MIN_RECT_DIMENSION || rect.height < MIN_RECT_DIMENSION) return false;
  if (containerWidth <= 0 || containerHeight <= 0) return false;
  const visibleBottom = rect.y + rect.height;
  const visibleRight = rect.x + rect.width;
  return (
    visibleBottom > 12 &&
    rect.y < containerHeight - 12 &&
    visibleRight > 12 &&
    rect.x < containerWidth - 12
  );
}

/** Ogranicza prostokąt źródłowy do sensownego zakresu, by animacja nie startowała spoza ekranu. */
export function clampSourceRect(
  rect: TransitionRect,
  containerWidth: number,
  containerHeight: number,
): TransitionRect {
  const width = Math.min(containerWidth, Math.max(MIN_RECT_DIMENSION, rect.width));
  const height = Math.min(containerHeight, Math.max(MIN_RECT_DIMENSION, rect.height));
  const x = Math.max(-width * 0.25, Math.min(containerWidth - width * 0.75, rect.x));
  const y = Math.max(-height * 0.35, Math.min(containerHeight - 24, rect.y));
  return { x, y, width, height };
}

/**
 * Oblicza przesunięcie potrzebne przy skalowaniu wokół środka widoku,
 * aby jego lewy górny róg został zakotwiczony w punkcie (0, 0).
 */
export function topLeftScaleTranslation(width: number, height: number, scale: number): Point2D {
  'worklet';
  return {
    x: (width * (scale - 1)) / 2,
    y: (height * (scale - 1)) / 2,
  };
}

/** Wylicza ramkę odklejanego ekranu podczas interaktywnego gestu wstecz. */
export function computeDragShellFrame(
  dragX: number,
  dragY: number,
  dragProgress: number,
  screenW: number,
  screenH: number,
): DragShellFrame {
  'worklet';
  const clampedProgress = Math.max(0, Math.min(1, dragProgress));
  const scale = 1 - clampedProgress * 0.18;
  const width = screenW * scale;
  const height = screenH * scale;
  const shiftX = Math.max(0, dragX) * 0.34;
  const rawShiftY = dragY * 0.24;
  const shiftY = Math.max(-96, Math.min(96, rawShiftY));
  const x = (screenW - width) / 2 + shiftX;
  const y = (screenH - height) / 2 + shiftY;
  const radius =
    clampedProgress <= 0.18
      ? (clampedProgress / 0.18) * 24
      : 24 + ((clampedProgress - 0.18) / 0.82) * 8;
  return { x, y, width, height, radius, scale };
}

/**
 * Wylicza ramkę odklejanego ekranu dla systemowego Android Predictive Back (API 34+)
 * według specyfikacji Material 3: skala 1 -> 0.84, margines 8dp od przeciwnej krawędzi
 * (obsługuje zarówno gest z lewej, jak i z prawej krawędzi) oraz miękkie śledzenie pionu.
 */
export function computePredictiveBackShellFrame(
  rawProgress: number,
  deltaY: number,
  swipeEdge: number,
  screenW: number,
  screenH: number,
): DragShellFrame {
  'worklet';
  const p = Math.max(0, Math.min(1, rawProgress));
  // Delikatne wygładzenie startu zgodne z krzywą M3 predictive back.
  const scale = 1 - p * 0.16;
  const width = screenW * scale;
  const height = screenH * scale;
  const maxShiftX = Math.max(0, (screenW - width) / 2 - 8);
  // Lewa krawędź (0) odsuwa ekran w prawo, prawa krawędź (1) w lewo.
  const direction = swipeEdge === 1 ? -1 : 1;
  const shiftX = direction * maxShiftX * p;
  const maxShiftY = Math.min(68, Math.max(0, (screenH - height) / 2 - 8));
  const rawShiftY = deltaY * 0.28 * Math.min(1, p * 2.2);
  const shiftY = Math.max(-maxShiftY, Math.min(maxShiftY, rawShiftY));
  const x = (screenW - width) / 2 + shiftX;
  const y = (screenH - height) / 2 + shiftY;
  const radius = p <= 0.16 ? (p / 0.16) * 22 : 22 + ((p - 0.16) / 0.84) * 6;
  return { x, y, width, height, radius, scale };
}

/**
 * Wylicza bieżącą pozycję paska JourneyStrip wewnątrz przeskalowanego ekranu
 * w momencie puszczenia palca, żeby lot powrotny do karty nie miał przeskoku.
 */
export function computeScaledStripRect(
  shell: Pick<DragShellFrame, 'x' | 'y' | 'scale'>,
  baseTargetStrip: TransitionRect,
  scrollY: number,
): TransitionRect {
  'worklet';
  return {
    x: shell.x + baseTargetStrip.x * shell.scale,
    y: shell.y + (baseTargetStrip.y - scrollY) * shell.scale,
    width: baseTargetStrip.width * shell.scale,
    height: baseTargetStrip.height * shell.scale,
  };
}

/** Rozstrzyga, czy puszczenie gestu wstecz powinno domknąć ekran szczegółów. */
export function shouldDismissFromGesture(dragProgress: number, velocityX: number): boolean {
  'worklet';
  if (dragProgress >= DISMISS_PROGRESS_THRESHOLD) return true;
  if (velocityX >= DISMISS_VELOCITY_X_FAST && dragProgress >= 0.04) return true;
  if (velocityX >= DISMISS_VELOCITY_X_MEDIUM && dragProgress >= DISMISS_PROGRESS_MEDIUM) {
    return true;
  }
  return false;
}

/** Wylicza czas domykania proporcjonalny do bieżącego postępu (np. przy przerwaniu otwierania). */
export function computeCloseDurationMs(currentProgress: number, baseDurationMs = 215): number {
  'worklet';
  const clamped = Math.max(0.15, Math.min(1, currentProgress));
  return Math.round(Math.max(115, baseDurationMs * (0.45 + 0.55 * clamped)));
}

/**
 * Zamienia docelową ramkę powłoki (lewy górny róg i przeskalowane wymiary)
 * na czyste transformacje GPU (`translateX`, `translateY`, `scale`) względem pełnego ekranu,
 * aby gest wstecz i Predictive Back nie wywoływały przeliczania layoutu Yoga w każdej klatce.
 */
export function computeGpuShellTransform(
  frame: Pick<DragShellFrame, 'x' | 'y' | 'radius' | 'scale'>,
  screenW: number,
  screenH: number,
): { translateX: number; translateY: number; scale: number; borderRadius: number } {
  'worklet';
  const scale = frame.scale;
  const anchorOffset = topLeftScaleTranslation(screenW, screenH, scale);
  return {
    translateX: frame.x + anchorOffset.x,
    translateY: frame.y + anchorOffset.y,
    scale,
    borderRadius: scale > 0.01 ? frame.radius / scale : frame.radius,
  };
}
