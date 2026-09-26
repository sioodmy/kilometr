import React from 'react';
import {
  ArrowDownUp,
  ArrowUpDown,
  BusFront,
  Clock3,
  Layers,
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
}

/**
 * Dolne menu ekranu połączeń — jedyne miejsce na filtry i akcje.
 * Wszystko, czym sterujemy jedną ręką w tramwaju, mieszka pod kciukiem:
 * odwrócenie trasy, czas odjazdu, filtr bezpośrednich, typ pojazdu,
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
}: RoutesThumbBarProps) {
  const renderModeIcon = () => {
    const color = modeFilter !== 'all' ? scheme.onPrimaryContainer : scheme.onSurfaceVariant;
    if (modeFilter === 'tram') return <TramFront size={17} color={color} />;
    if (modeFilter === 'bus') return <BusFront size={17} color={color} />;
    return <Layers size={17} color={color} />;
  };

  const modeLabel =
    modeFilter === 'tram' ? 'Tramwaje' : modeFilter === 'bus' ? 'Autobusy' : 'Pojazdy';

  const sortLabel = sortMode === 'fastest' ? 'Najszybciej' : 'Najwcześniej';

  return (
    <ThumbBar>
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
          <Zap
            size={17}
            color={directOnly ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
            fill={directOnly ? scheme.onPrimaryContainer : 'transparent'}
          />
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
        icon={renderModeIcon()}
        label={modeLabel}
        accessibilityLabel={`Filtruj środek transportu: aktualnie ${modeLabel}. Dotknij, aby zmienić.`}
      />

      <ThumbBarDivider />

      <ThumbBarItem
        onPress={onOpenTimeSheet}
        active={isCustomTime}
        icon={
          <Clock3
            size={17}
            color={isCustomTime ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
          />
        }
        label={timeLabel}
        accessibilityLabel={`Czas odjazdu: ${timeLabel}. Dotknij, aby zmienić.`}
      />

      <ThumbBarDivider />

      <ThumbBarItem
        onPress={onCycleSort}
        active={sortMode === 'earliest'}
        icon={
          <ArrowDownUp
            size={17}
            color={sortMode === 'earliest' ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
          />
        }
        label={sortLabel}
        accessibilityLabel={`Sortowanie: ${sortLabel}. Dotknij, aby zmienić.`}
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
            style={{ flex: 0, minWidth: 46, paddingHorizontal: 6 }}
            accessibilityLabel="Odśwież rozkłady i pozycje na żywo"
          />
        </>
      ) : null}
    </ThumbBar>
  );
}
