import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { Connection } from '../types/models';
import { normalizeConnectionId } from '../services/routing/connectionIdentity';
import {
  clampSourceRect,
  computeStripRect,
  isValidTransitionRect,
  toRelativeRect,
  type CardSurfaceVariant,
  type TransitionRect,
} from './routeCardTransitionMath';

export interface CardTransitionSource {
  connectionId: string;
  normalizedId: string;
  connection: Connection;
  cardRect: TransitionRect;
  stripRect: TransitionRect | null;
  variant: CardSurfaceVariant;
  dimmed: boolean;
  capturedAt: number;
}

interface RegisteredCardHandle {
  viewRef: RefObject<View | null>;
  getStripLocalRect: () => TransitionRect | null;
  getVariant: () => CardSurfaceVariant;
  getDimmed: () => boolean;
}

interface MeasuredCardGeometry {
  cardRect: TransitionRect;
  stripRect: TransitionRect | null;
  variant: CardSurfaceVariant;
  dimmed: boolean;
}

interface RouteCardTransitionContextValue {
  /** ID karty ukrytej na liście na czas rozciągnięcia (współdzielone na wątku UI bez re-renderu FlatList). */
  hiddenCardId: SharedValue<string>;
  registerCard: (connectionId: string, handle: RegisteredCardHandle) => () => void;
  measureCard: (connectionId: string) => Promise<MeasuredCardGeometry | null>;
  prepareTransition: (source: CardTransitionSource) => void;
  consumeTransition: (normalizedId: string) => CardTransitionSource | null;
  getContainerSize: () => { width: number; height: number };
}

const RouteCardTransitionContext = createContext<RouteCardTransitionContextValue | null>(null);

const PENDING_TTL_MS = 2500;

function measureWindowAsync(view: View | null): Promise<TransitionRect | null> {
  if (!view || typeof view.measureInWindow !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (rect: TransitionRect | null) => {
      if (settled) return;
      settled = true;
      resolve(rect);
    };
    const timer = setTimeout(() => finish(null), 60);
    try {
      view.measureInWindow((x, y, width, height) => {
        clearTimeout(timer);
        if (
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          Number.isFinite(width) &&
          Number.isFinite(height) &&
          width > 0 &&
          height > 0
        ) {
          finish({ x, y, width, height });
        } else {
          finish(null);
        }
      });
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

/**
 * Dostarcza współdzielony układ współrzędnych oraz rejestr kart listy połączeń,
 * aby przejście do szczegółów odbywało się bez re-renderów listy i bez rozjazdu insetów.
 */
export function RouteCardTransitionProvider({ children }: { children: ReactNode }) {
  const containerRef = useRef<View>(null);
  const containerOriginRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const containerMeasuredRef = useRef(false);
  const cardsRef = useRef<Map<string, RegisteredCardHandle>>(new Map());
  const pendingRef = useRef<CardTransitionSource | null>(null);
  const hiddenCardId = useSharedValue('');

  const syncContainerOrigin = useCallback(async (): Promise<{
    origin: { x: number; y: number };
    width: number;
    height: number;
  }> => {
    const measured = await measureWindowAsync(containerRef.current);
    if (measured) {
      containerOriginRef.current = { x: measured.x, y: measured.y };
      containerSizeRef.current = { width: measured.width, height: measured.height };
      containerMeasuredRef.current = measured.width > 0 && measured.height > 0;
      return {
        origin: containerOriginRef.current,
        width: measured.width,
        height: measured.height,
      };
    }
    return {
      origin: containerOriginRef.current,
      width: containerSizeRef.current.width,
      height: containerSizeRef.current.height,
    };
  }, []);

  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      containerSizeRef.current = { width, height };
    }
    void measureWindowAsync(containerRef.current).then((measured) => {
      if (measured) {
        containerOriginRef.current = { x: measured.x, y: measured.y };
        containerSizeRef.current = { width: measured.width, height: measured.height };
        containerMeasuredRef.current = measured.width > 0 && measured.height > 0;
      }
    });
  }, []);

  const registerCard = useCallback((connectionId: string, handle: RegisteredCardHandle) => {
    const key = normalizeConnectionId(connectionId);
    cardsRef.current.set(key, handle);
    return () => {
      if (cardsRef.current.get(key) === handle) {
        cardsRef.current.delete(key);
      }
    };
  }, []);

  const measureCard = useCallback(
    async (connectionId: string): Promise<MeasuredCardGeometry | null> => {
      const key = normalizeConnectionId(connectionId);
      const handle = cardsRef.current.get(key);
      if (!handle) return null;
      const cachedContainer =
        containerMeasuredRef.current &&
        containerSizeRef.current.width > 0 &&
        containerSizeRef.current.height > 0
          ? {
              origin: containerOriginRef.current,
              width: containerSizeRef.current.width,
              height: containerSizeRef.current.height,
            }
          : null;
      const [container, rawCardRect] = await Promise.all([
        cachedContainer ? Promise.resolve(cachedContainer) : syncContainerOrigin(),
        measureWindowAsync(handle.viewRef.current),
      ]);
      if (!rawCardRect) return null;
      const relative = toRelativeRect(rawCardRect, container.origin);
      if (!isValidTransitionRect(relative, container.width, container.height)) {
        return null;
      }
      const clampedCard = clampSourceRect(relative, container.width, container.height);
      const stripLocal = handle.getStripLocalRect();
      const rawStrip = computeStripRect(relative, stripLocal);
      const stripRect =
        rawStrip != null
          ? {
              x: clampedCard.x + (rawStrip.x - relative.x),
              y: clampedCard.y + (rawStrip.y - relative.y),
              width: rawStrip.width,
              height: rawStrip.height,
            }
          : null;
      return {
        cardRect: clampedCard,
        stripRect,
        variant: handle.getVariant(),
        dimmed: handle.getDimmed(),
      };
    },
    [syncContainerOrigin],
  );

  const prepareTransition = useCallback((source: CardTransitionSource) => {
    pendingRef.current = source;
  }, []);

  const consumeTransition = useCallback((normalizedId: string): CardTransitionSource | null => {
    const pending = pendingRef.current;
    if (!pending) return null;
    if (Date.now() - pending.capturedAt > PENDING_TTL_MS) {
      pendingRef.current = null;
      return null;
    }
    if (pending.normalizedId !== normalizedId) return null;
    pendingRef.current = null;
    return pending;
  }, []);

  const getContainerSize = useCallback(() => containerSizeRef.current, []);

  const value = useMemo<RouteCardTransitionContextValue>(
    () => ({
      hiddenCardId,
      registerCard,
      measureCard,
      prepareTransition,
      consumeTransition,
      getContainerSize,
    }),
    [
      hiddenCardId,
      registerCard,
      measureCard,
      prepareTransition,
      consumeTransition,
      getContainerSize,
    ],
  );

  return (
    <RouteCardTransitionContext.Provider value={value}>
      <View
        ref={containerRef}
        collapsable={false}
        onLayout={handleContainerLayout}
        style={styles.root}
      >
        {children}
      </View>
    </RouteCardTransitionContext.Provider>
  );
}

export function useRouteCardTransition(): RouteCardTransitionContextValue | null {
  return useContext(RouteCardTransitionContext);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
