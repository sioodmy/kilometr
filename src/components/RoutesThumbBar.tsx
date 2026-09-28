import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import {
  ArrowUpDown,
  BusFront,
  Clock3,
  Layers,
  TramFront,
  Zap,
} from 'lucide-react-native';
import { scheme } from '../theme/tokens';
import { ThumbBar, ThumbBarDivider, ThumbBarItem } from './ThumbBar';
import { useStrings } from '../i18n';

/** Filtr środka transportu. Jedyne miejsce, w którym żyje ten typ. */
export type ModePreference = 'all' | 'tram' | 'bus';

/** Sortowanie listy połączeń. */
export type SortMode = 'fastest' | 'earliest';

// ─── Swipe ikon zamiast popu ────────────────────────────────────────────────
// Krótki (170 ms) pionowy wjazd z fade: włączenie / następny pojazd = swipe up,
// wyłączenie / powrót = swipe down. Własny Keyframe zamiast gotowego SlideIn*,
// żeby dystans był mały (10 px, nie pół ekranu).
const SWIPE_MS = 170;
const SWIPE_EASING = Easing.out(Easing.cubic);

const slideUpIn = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 10 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: SWIPE_EASING },
}).duration(SWIPE_MS);

const slideDownIn = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: -10 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: SWIPE_EASING },
}).duration(SWIPE_MS);

const iconOut = FadeOut.duration(90);

export interface RoutesThumbBarProps {
  onSwap: () => void;
  directOnly: boolean;
  onToggleDirect: () => void;
  timeLabel: string;
  isCustomTime: boolean;
  onOpenTimeSheet: () => void;
  modeFilter: ModePreference;
  onCycleMode: () => void;
  /** Animowany styl hide/show ze scrolla (translateY + opacity z rodzica). */
  animatedStyle?: AnimatedStyle<ViewStyle>;
}

/**
 * Dolne menu ekranu połączeń — filtry i akcje pod kciukiem.
 * Wszystko, czym sterujemy jedną ręką w tramwaju, mieszka na dole:
 * odwrócenie trasy, filtr bezpośrednich, typ pojazdu i czas odjazdu.
 * Sortowanie wróciło do górnego paska (toggle iOS), a odświeżanie
 * jest gestem pull-to-refresh na liście. Góra pokazuje skąd dokąd.
 */
export function RoutesThumbBar({
  onSwap,
  directOnly,
  onToggleDirect,
  timeLabel,
  isCustomTime,
  onOpenTimeSheet,
  modeFilter,
  onCycleMode,
  animatedStyle,
}: RoutesThumbBarProps) {
  const s = useStrings();
  const renderModeIcon = () => {
    const color = modeFilter !== 'all' ? scheme.onPrimaryContainer : scheme.onSurfaceVariant;
    if (modeFilter === 'tram') return <TramFront size={17} color={color} />;
    if (modeFilter === 'bus') return <BusFront size={17} color={color} />;
    return <Layers size={17} color={color} />;
  };

  // Krótko, żeby nie ucinało w wąskim guziku (pełne nazwy w a11y).
  const modeLabel = modeFilter === 'tram' ? s.routesBar.modeTram : modeFilter === 'bus' ? s.routesBar.modeBus : s.routesBar.modeAll;
  const modeA11y =
    modeFilter === 'tram' ? s.routesBar.modeTramA11y : modeFilter === 'bus' ? s.routesBar.modeBusA11y : s.routesBar.modeAllA11y;

  // Etykieta czasu bywa pełna („Jutro, 08:15”) i nie mieściłaby się w kolumnie,
  // więc w docku zostaje sama godzina. Dzień i tak widać w nagłówku listy,
  // a pełna etykieta idzie do accessibilityLabel.
  const timeShort = timeLabel.includes(', ') ? timeLabel.split(', ')[1] : timeLabel;

  // Pop przy swapie: pełny obrót 360° + minimalny pop skali, w tym samym
  // timingu co rolka tekstu nagłówka (FadeInUp 240 ms) — góra i dół kręcą się razem.
  const swapSpin = useSharedValue(0);
  const swapStyle = useAnimatedStyle(() => {
    const p = swapSpin.value % 1;
    return {
      transform: [
        { rotate: `${p * 360}deg` },
        { scale: 1 + 0.28 * Math.sin(Math.PI * p) },
      ],
    };
  });
  const handleSwapPress = () => {
    swapSpin.value = withTiming(Math.round(swapSpin.value) + 1, {
      duration: 240,
      easing: Easing.inOut(Easing.ease),
    });
    onSwap();
  };

  return (
    // Dock przyjmuje gotowy styl animowany (chowanie się przy scrollu),
    // więc rzutujemy go na zwykły styl — ThumbBar opakowuje go w Animated.View.
    <ThumbBar style={animatedStyle as StyleProp<ViewStyle>}>
      <ThumbBarItem
        onPress={handleSwapPress}
        icon={
          <Animated.View style={swapStyle}>
            <ArrowUpDown size={17} color={scheme.onSurfaceVariant} />
          </Animated.View>
        }
        label={s.routesBar.reverse}
        accessibilityLabel={s.routesBar.reverseA11y}
      />

      <ThumbBarDivider />

      <ThumbBarItem
        onPress={onToggleDirect}
        active={directOnly}
        icon={
          <Animated.View
            key={directOnly ? 'direct-on' : 'direct-off'}
            entering={directOnly ? slideUpIn : slideDownIn}
            exiting={iconOut}
          >
            <Zap
              size={17}
              color={directOnly ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
              fill={directOnly ? scheme.onPrimaryContainer : 'transparent'}
            />
          </Animated.View>
        }
        label={s.routesBar.direct}
        accessibilityLabel={
          directOnly
            ? s.routesBar.directOnA11y
            : s.routesBar.directOffA11y
        }
      />

      <ThumbBarDivider />

      <ThumbBarItem
        onPress={onCycleMode}
        active={modeFilter !== 'all'}
        icon={
          <Animated.View key={modeFilter} entering={slideUpIn} exiting={iconOut}>
            {renderModeIcon()}
          </Animated.View>
        }
        label={modeLabel}
        accessibilityLabel={s.routesBar.modeFilterA11y(modeA11y)}
      />

      <ThumbBarDivider />

      <ThumbBarItem
        onPress={onOpenTimeSheet}
        active={isCustomTime}
        icon={
          <Animated.View
            key={isCustomTime ? 'time-custom' : 'time-now'}
            entering={isCustomTime ? slideUpIn : slideDownIn}
            exiting={iconOut}
          >
            <Clock3
              size={17}
              color={isCustomTime ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            />
          </Animated.View>
        }
        label={timeShort}
        accessibilityLabel={s.routesBar.timeA11y(timeLabel)}
      />
    </ThumbBar>
  );
}
