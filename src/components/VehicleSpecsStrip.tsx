import React, { memo, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, useReducedMotion } from 'react-native-reanimated';
import {
  Accessible,
  AcUnit,
  AirlineSeatFlat,
  AirlineSeatIndividualSuite,
  BusFront,
  DirectionsBike,
  LocalBar,
  ModeFanOff,
  Power,
  Restaurant,
  Stairs,
  TrainFront,
  TramFront,
  Usb,
  VolumeOff,
  Wifi,
} from './icons';
import { SkeletonBone, SkeletonPulse } from './SkeletonPulse';
import { useStrings, type Strings } from '../i18n';
import type { RailAmenities } from '../services/railAmenities';
import { selectRailAmenitiesForStrip, type VehicleSpecs } from '../services/vehicleInfo';
import type { LegMode, RailAmenity } from '../types/models';
import { scheme, shape, type } from '../theme/tokens';

const AMENITY_ICONS: Record<RailAmenity, ComponentType<{ size?: number; color?: string }>> = {
  klimatyzacja: AcUnit,
  gniazdka_230V: Power,
  gniazdka_usb: Usb,
  wifi: Wifi,
  wagon_restauracyjny: Restaurant,
  bar: LocalBar,
  przewoz_rowerow: DirectionsBike,
  dostepny_wozkarze: Accessible,
  miejsca_lezace: AirlineSeatFlat,
  miejsca_sypialne: AirlineSeatIndividualSuite,
  strefa_ciszy: VolumeOff,
};

/** Ile chipów z ikonami montujemy na raz, by starsze urządzenia nie gubiły klatek. */
const CHIP_BATCH_SIZE = 4;

/** Szerokości mock chipów (px) imitujące typowe etykiety udogodnień składu. */
const MOCK_CHIP_WIDTHS = [68, 86, 54, 78, 62, 74] as const;

interface VehicleSpecsStripProps {
  specs?: VehicleSpecs | null;
  railAmenities?: RailAmenities | null;
  mode: LegMode;
  /** Dane udogodnień składu wczytują się z lokalnej bazy. */
  loading?: boolean;
  /** Odracza montaż ciężkich ikon na kolejną klatkę po otwarciu ekranu. */
  deferGraphics?: boolean;
}

/** Zwraca zwięzły opis cech pojazdu i udogodnień składu dla czytnika ekranu (TalkBack/VoiceOver). */
export function formatVehicleSpecsA11y(
  specs: VehicleSpecs | null | undefined,
  t: Strings,
  railAmenities?: RailAmenities | null,
): string | undefined {
  const sections: string[] = [];

  if (specs) {
    const parts: string[] = [specs.model];
    if (specs.floor === 'low') parts.push(t.vehicleInfo.lowFloor);
    else if (specs.floor === 'partial') parts.push(t.vehicleInfo.partialLowFloor);
    else if (specs.floor === 'high') parts.push(t.vehicleInfo.highFloor);

    if (specs.ac === 'yes') parts.push(t.vehicleInfo.ac);
    else if (specs.ac === 'no') parts.push(t.vehicleInfo.noAc);

    if (specs.vintage) parts.push(t.vehicleInfo.vintage);
    else if (specs.drive === 'electric') parts.push(t.vehicleInfo.electric);
    else if (specs.drive === 'hydrogen') parts.push(t.vehicleInfo.hydrogen);
    else if (specs.drive === 'hybrid') parts.push(t.vehicleInfo.hybrid);

    sections.push(t.vehicleInfo.a11y(parts.join(', ')));
  }

  const amenityKeys = railAmenities ? selectRailAmenitiesForStrip(railAmenities.keys, specs) : [];
  if (railAmenities && amenityKeys.length > 0) {
    const labels = amenityKeys.map((key) => t.railAmenities[key](railAmenities.counts[key]));
    sections.push(t.railAmenities.a11y(labels.join(', ')));
  }

  return sections.length > 0 ? sections.join(', ') : undefined;
}

function ModeGlyph({ mode, color }: { mode: LegMode; color: string }) {
  if (mode === 'tram') return <TramFront size={13} color={color} />;
  if (mode === 'train' || mode === 'subway') return <TrainFront size={13} color={color} />;
  return <BusFront size={13} color={color} />;
}

/** Mock chip (kółko ikony + pasek etykiety) o wymiarach zgodnych z prawdziwym chipem. */
function MockChip({ width }: { width: number }) {
  return (
    <View style={s.mockChip}>
      <SkeletonBone width={13} height={13} radius={shape.full} />
      <SkeletonBone width={width} height={10} radius={5} />
    </View>
  );
}

/** Mock paska pojazdu / udogodnień składu w stanie ładowania. */
const VehicleSpecsSkeleton = memo(function VehicleSpecsSkeleton({
  chipCount,
  headerLabel,
}: {
  chipCount: number;
  headerLabel?: string;
}) {
  const count = Math.max(0, Math.min(6, chipCount));
  return (
    <View style={s.tray}>
      <SkeletonPulse style={s.skeletonInner}>
        <View style={s.headerRow}>
          <SkeletonBone width={13} height={13} radius={4} />
          {headerLabel ? (
            <Text style={s.modelText} numberOfLines={1} ellipsizeMode="tail">
              {headerLabel}
            </Text>
          ) : (
            <SkeletonBone width={128} height={12} radius={6} />
          )}
        </View>
        {count > 0 ? (
          <View style={s.chipsRow}>
            {Array.from({ length: count }, (_, idx) => (
              <MockChip
                key={idx}
                width={MOCK_CHIP_WIDTHS[idx % MOCK_CHIP_WIDTHS.length]}
              />
            ))}
          </View>
        ) : null}
      </SkeletonPulse>
    </View>
  );
});

/**
 * Zagnieżdżony pasek M3 Expressive wewnątrz karty linii w szczegółach połączenia.
 * Pokazuje model pojazdu z zbiorkom.live (podłoga, klima, starszy tabor) oraz
 * spójne wizualnie chipy udogodnień składu z vagonweb dla pociągów.
 * Przy ładowaniu lub dużej liczbie ikon renderuje mock chipy w loading state
 * i progresywnie odsłania kolejne partie bez blokowania klatek.
 */
export const VehicleSpecsStrip = memo(function VehicleSpecsStrip({
  specs,
  railAmenities,
  mode,
  loading = false,
  deferGraphics = false,
}: VehicleSpecsStripProps) {
  const t = useStrings();
  const reduceMotion = useReducedMotion();

  const amenityKeys = railAmenities ? selectRailAmenitiesForStrip(railAmenities.keys, specs) : [];
  const hasSpecsData = Boolean(specs || amenityKeys.length > 0);

  const floorCount = specs && specs.floor !== 'unknown' ? 1 : 0;
  const acCount = specs && specs.ac !== 'unknown' ? 1 : 0;
  const totalChipCount = floorCount + acCount + amenityKeys.length;
  const isWaitingForData = loading && !hasSpecsData;
  const isDeferred = deferGraphics && (hasSpecsData || loading);

  const [revealedCount, setRevealedCount] = useState(() =>
    isWaitingForData || isDeferred
      ? 0
      : Math.min(totalChipCount, CHIP_BATCH_SIZE),
  );

  useEffect(() => {
    if (isWaitingForData || isDeferred) {
      setRevealedCount(0);
      return;
    }
    if (totalChipCount <= CHIP_BATCH_SIZE) {
      setRevealedCount(totalChipCount);
      return;
    }
    let cancelled = false;
    let rafId: number | null = null;
    setRevealedCount((prev) => Math.max(prev, CHIP_BATCH_SIZE));

    const step = () => {
      if (cancelled) return;
      setRevealedCount((prev) => {
        const next = Math.min(totalChipCount, prev + CHIP_BATCH_SIZE);
        if (next < totalChipCount) {
          rafId = requestAnimationFrame(step);
        }
        return next;
      });
    };

    rafId = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isWaitingForData, isDeferred, totalChipCount]);

  if (isWaitingForData || isDeferred) {
    const placeholderChips =
      loading && !hasSpecsData ? 4 : Math.min(6, totalChipCount);
    return (
      <VehicleSpecsSkeleton
        chipCount={placeholderChips}
        headerLabel={specs?.model}
      />
    );
  }

  if (!specs && amenityKeys.length === 0) return null;

  const floorChip =
    specs?.floor === 'low'
      ? {
          label: t.vehicleInfo.lowFloor,
          bg: s.chipLowFloor,
          textStyle: s.chipLowFloorText,
          icon: <Accessible size={13} color={scheme.onSecondaryContainer} />,
        }
      : specs?.floor === 'partial'
        ? {
            label: t.vehicleInfo.partialLowFloor,
            bg: s.chipNeutral,
            textStyle: s.chipNeutralText,
            icon: <Accessible size={13} color={scheme.onSurface} />,
          }
        : specs?.floor === 'high'
          ? {
              label: t.vehicleInfo.highFloor,
              bg: s.chipWarn,
              textStyle: s.chipWarnText,
              icon: <Stairs size={13} color={scheme.onWarningContainer} />,
            }
          : null;

  const acChip =
    specs?.ac === 'yes'
      ? {
          label: t.vehicleInfo.ac,
          bg: s.chipAc,
          textStyle: s.chipAcText,
          icon: <AcUnit size={13} color={scheme.onTertiaryContainer} />,
        }
      : specs?.ac === 'no'
        ? {
            label: t.vehicleInfo.noAc,
            bg: s.chipWarn,
            textStyle: s.chipWarnText,
            icon: <ModeFanOff size={13} color={scheme.onWarningContainer} />,
          }
        : null;

  const metaTag = specs?.vintage
    ? { label: t.vehicleInfo.vintage, style: s.metaVintage }
    : specs?.drive === 'electric'
      ? { label: t.vehicleInfo.electric, style: s.metaElectric }
      : specs?.drive === 'hydrogen'
        ? { label: t.vehicleInfo.hydrogen, style: s.metaElectric }
        : specs?.drive === 'hybrid'
          ? { label: t.vehicleInfo.hybrid, style: s.metaHybrid }
          : null;

  const headerTitle = specs ? specs.model : t.railAmenities.title;
  const hasChips = floorChip !== null || acChip !== null || amenityKeys.length > 0;
  const prefixCount = (floorChip ? 1 : 0) + (acChip ? 1 : 0);
  const visibleAmenitiesCount = Math.max(0, revealedCount - prefixCount);
  const visibleAmenityKeys = amenityKeys.slice(0, visibleAmenitiesCount);
  const pendingMockCount = Math.max(0, amenityKeys.length - visibleAmenityKeys.length);

  return (
    <Animated.View
      entering={!reduceMotion ? FadeIn.duration(150).reduceMotion(ReduceMotion.System) : undefined}
      style={s.tray}
    >
      <View style={s.headerRow}>
        <ModeGlyph
          mode={mode}
          color={specs?.vintage ? scheme.warning : scheme.onSurfaceVariant}
        />
        <Text style={s.modelText} numberOfLines={1} ellipsizeMode="tail">
          {headerTitle}
        </Text>
        {metaTag ? (
          <Text style={[s.metaTag, metaTag.style]} numberOfLines={1}>
            {metaTag.label}
          </Text>
        ) : null}
      </View>

      {hasChips ? (
        <View style={s.chipsRow}>
          {floorChip ? (
            <View style={[s.chip, floorChip.bg]}>
              {floorChip.icon}
              <Text style={[s.chipText, floorChip.textStyle]} numberOfLines={1} ellipsizeMode="tail">
                {floorChip.label}
              </Text>
            </View>
          ) : null}
          {acChip ? (
            <View style={[s.chip, acChip.bg]}>
              {acChip.icon}
              <Text style={[s.chipText, acChip.textStyle]} numberOfLines={1} ellipsizeMode="tail">
                {acChip.label}
              </Text>
            </View>
          ) : null}
          {railAmenities
            ? visibleAmenityKeys.map((key) => {
                const Icon = AMENITY_ICONS[key];
                const isAccess = key === 'dostepny_wozkarze';
                const isAc = key === 'klimatyzacja';
                const chipBg = isAccess ? s.chipLowFloor : isAc ? s.chipAc : s.chipNeutral;
                const chipTextStyle = isAccess
                  ? s.chipLowFloorText
                  : isAc
                    ? s.chipAcText
                    : s.chipNeutralText;
                const iconColor = isAccess
                  ? scheme.onSecondaryContainer
                  : isAc
                    ? scheme.onTertiaryContainer
                    : scheme.onSurface;
                return (
                  <View key={key} style={[s.chip, chipBg]}>
                    <Icon size={13} color={iconColor} />
                    <Text
                      style={[s.chipText, chipTextStyle]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {t.railAmenities[key](railAmenities.counts[key])}
                    </Text>
                  </View>
                );
              })
            : null}
          {pendingMockCount > 0 ? (
            <SkeletonPulse style={s.pendingChipsWrap}>
              {Array.from({ length: pendingMockCount }, (_, idx) => (
                <MockChip
                  key={`pending-${idx}`}
                  width={MOCK_CHIP_WIDTHS[(visibleAmenityKeys.length + idx) % MOCK_CHIP_WIDTHS.length]}
                />
              ))}
            </SkeletonPulse>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
});

const s = StyleSheet.create({
  tray: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.medium,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 7,
  },
  skeletonInner: {
    gap: 7,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modelText: {
    ...type.labelMedium,
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  metaTag: {
    ...type.labelSmall,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    flexShrink: 0,
  },
  metaVintage: {
    color: scheme.warning,
  },
  metaElectric: {
    color: scheme.primary,
  },
  metaHybrid: {
    color: scheme.onSurfaceVariant,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pendingChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
    borderRadius: shape.small,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  mockChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 23,
    borderRadius: shape.small,
    paddingHorizontal: 8,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  chipLowFloor: {
    backgroundColor: scheme.secondaryContainer,
  },
  chipLowFloorText: {
    color: scheme.onSecondaryContainer,
  },
  chipNeutral: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  chipNeutralText: {
    color: scheme.onSurface,
  },
  chipAc: {
    backgroundColor: scheme.tertiaryContainer,
  },
  chipAcText: {
    color: scheme.onTertiaryContainer,
  },
  chipWarn: {
    backgroundColor: scheme.warningContainer,
  },
  chipWarnText: {
    color: scheme.onWarningContainer,
  },
  chipText: {
    ...type.labelSmall,
    flexShrink: 1,
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '600',
  },
});
