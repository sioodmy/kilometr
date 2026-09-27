import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  Keyframe,
  type AnimatedStyle,
} from 'react-native-reanimated';
import {
  ArrowUpDown,
  BusFront,
  Clock3,
  Layers,
  Rocket,
  RotateCw,
  TramFront,
  Zap,
} from 'lucide-react-native';
import { scheme } from '../theme/tokens';
import { ThumbBar, ThumbBarDivider, ThumbBarItem } from './ThumbBar';

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
  sortMode: SortMode;
  onCycleSort: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Animowany styl hide/show ze scrolla (translateY + opacity z rodzica). */
  animatedStyle?: AnimatedStyle<ViewStyle>;
}

/**
 * Dolne menu ekranu połączeń — jedyne miejsce na filtry i akcje.
 * Wszystko, czym sterujemy jedną ręką w tramwaju, mieszka pod kciukiem:
 * odwrócenie trasy, filtr bezpośrednich, typ pojazdu, czas odjazdu,
 * sortowanie i odświeżenie danych live. Górna część ekranu ma tylko
 * pokazywać skąd dokąd i listę.
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
  sortMode,
  onCycleSort,
  onRefresh,
  refreshing,
  animatedStyle,
}: RoutesThumbBarProps) {
  const renderModeIcon = () => {
    const color = modeFilter !== 'all' ? scheme.onPrimaryContainer : scheme.onSurfaceVariant;
    if (modeFilter === 'tram') return <TramFront size={17} color={color} />;
    if (modeFilter === 'bus') return <BusFront size={17} color={color} />;
    return <Layers size={17} color={color} />;
  };

  // Krótko, żeby nie ucinało w wąskim guziku (pełne nazwy w a11y).
  const modeLabel = modeFilter === 'tram' ? 'Tram' : modeFilter === 'bus' ? 'Bus' : 'Pojazdy';
  const modeA11y =
    modeFilter === 'tram' ? 'Tramwaje' : modeFilter === 'bus' ? 'Autobusy' : 'Wszystkie pojazdy';

  // Kolumna w docku ma ~53 dp, a czcionka 10 px — „Najszybciej” nie mieści
  // się i ucinałoby się w „Najszybc…”. Krótkie polskie nazwy pary są czytelne,
  // a dokładne brzmienie zostaje w accessibilityLabel.
  const sortLabel = sortMode === 'fastest' ? 'Przyjazd' : 'Wyjazd';

  // Etykieta czasu bywa pełna („Jutro, 08:15”) i nie mieściłaby się w kolumnie,
  // więc w docku zostaje sama godzina. Dzień i tak widać w nagłówku listy,
  // a pełna etykieta idzie do accessibilityLabel.
  const timeShort = timeLabel.includes(', ') ? timeLabel.split(', ')[1] : timeLabel;

  return (
    // Dock przyjmuje gotowy styl animowany (chowanie się przy scrollu),
    // więc rzutujemy go na zwykły styl — ThumbBar opakowuje go w Animated.View.
    <ThumbBar style={animatedStyle as StyleProp<ViewStyle>}>
      <ThumbBarItem
        onPress={onSwap}
        icon={<ArrowUpDown size={17} color={scheme.primary} />}
        label="Odwróć"
        accessibilityLabel="Odwróć trasę: zamień punkt startowy z docelowym"
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
        label="Bezpośr."
        accessibilityLabel={
          directOnly
            ? 'Filtr połączeń bezpośrednich: aktywny. Dotknij, aby pokazać wszystkie.'
            : 'Filtr połączeń bezpośrednich: nieaktywny. Dotknij, aby włączyć.'
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
        accessibilityLabel={`Filtruj środek transportu: aktualnie ${modeA11y}. Dotknij, aby zmienić.`}
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
        accessibilityLabel={`Czas odjazdu: ${timeLabel}. Dotknij, aby zmienić.`}
      />

      <ThumbBarDivider />

      <ThumbBarItem
        onPress={onCycleSort}
        mode
        active={sortMode === 'earliest'}
        icon={
          <Animated.View
            key={sortMode}
            entering={sortMode === 'earliest' ? slideUpIn : slideDownIn}
            exiting={iconOut}
          >
            {/* Ikona niesie tryb: rakieta = najszybszy przyjazd, zegar =
                najwcześniejszy odjazd. Sam przycisk jest zawsze wypełniony,
                bo sortowanie ma zawsze jakąś wartość. */}
            {sortMode === 'earliest' ? (
              <Clock3 size={17} color={scheme.onPrimaryContainer} />
            ) : (
              <Rocket size={17} color={scheme.onSecondaryContainer} />
            )}
          </Animated.View>
        }
        label={sortLabel}
        accessibilityLabel={`Sortowanie: ${
          sortMode === 'fastest'
            ? 'najszybszy przyjazd'
            : 'najwcześniejszy odjazd'
        }. Dotknij, aby zmienić.`}
      />

      {onRefresh ? (
        <>
          <ThumbBarDivider />
          <ThumbBarItem
            onPress={onRefresh}
            icon={
              <RotateCw size={17} color={refreshing ? scheme.primary : scheme.onSurfaceVariant} />
            }
            label=""
            style={styles.iconOnly}
            accessibilityLabel="Odśwież rozkłady i pozycje na żywo"
          />
        </>
      ) : null}
    </ThumbBar>
  );
}

const styles = StyleSheet.create({
  // Odświeżenie zostaje samą ikoną, więc nie potrzebuje całej kolumny.
  iconOnly: {
    flex: 0,
    maxWidth: 44,
  },
});
