import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  Accessible,
  AcUnit,
  BusFront,
  ModeFanOff,
  Stairs,
  TrainFront,
  TramFront,
} from './icons';
import { useStrings, type Strings } from '../i18n';
import type { VehicleSpecs } from '../services/vehicleInfo';
import type { LegMode } from '../types/models';
import { scheme, shape, type } from '../theme/tokens';

interface VehicleSpecsStripProps {
  specs: VehicleSpecs;
  mode: LegMode;
}

/** Zwraca zwięzły opis cech pojazdu dla czytnika ekranu (TalkBack/VoiceOver). */
export function formatVehicleSpecsA11y(specs: VehicleSpecs, t: Strings): string {
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

  return t.vehicleInfo.a11y(parts.join(', '));
}

function ModeGlyph({ mode, color }: { mode: LegMode; color: string }) {
  if (mode === 'tram') return <TramFront size={13} color={color} />;
  if (mode === 'train' || mode === 'subway') return <TrainFront size={13} color={color} />;
  return <BusFront size={13} color={color} />;
}

/**
 * Zagnieżdżony pasek M3 Expressive wewnątrz karty linii w szczegółach połączenia.
 * Pokazuje model konkretnego pojazdu z zbiorkom.live oraz do 2 chipów (podłoga, klima)
 * bez zgadywania niepotwierdzonych cech.
 */
export function VehicleSpecsStrip({ specs, mode }: VehicleSpecsStripProps) {
  const t = useStrings();

  const floorChip =
    specs.floor === 'low'
      ? {
          label: t.vehicleInfo.lowFloor,
          bg: s.chipLowFloor,
          textStyle: s.chipLowFloorText,
          icon: <Accessible size={13} color={scheme.onSecondaryContainer} />,
        }
      : specs.floor === 'partial'
        ? {
            label: t.vehicleInfo.partialLowFloor,
            bg: s.chipPartialFloor,
            textStyle: s.chipPartialFloorText,
            icon: <Accessible size={13} color={scheme.onSurface} />,
          }
        : specs.floor === 'high'
          ? {
              label: t.vehicleInfo.highFloor,
              bg: s.chipWarn,
              textStyle: s.chipWarnText,
              icon: <Stairs size={13} color={scheme.onWarningContainer} />,
            }
          : null;

  const acChip =
    specs.ac === 'yes'
      ? {
          label: t.vehicleInfo.ac,
          bg: s.chipAc,
          textStyle: s.chipAcText,
          icon: <AcUnit size={13} color={scheme.onTertiaryContainer} />,
        }
      : specs.ac === 'no'
        ? {
            label: t.vehicleInfo.noAc,
            bg: s.chipWarn,
            textStyle: s.chipWarnText,
            icon: <ModeFanOff size={13} color={scheme.onWarningContainer} />,
          }
        : null;

  const metaTag = specs.vintage
    ? { label: t.vehicleInfo.vintage, style: s.metaVintage }
    : specs.drive === 'electric'
      ? { label: t.vehicleInfo.electric, style: s.metaElectric }
      : specs.drive === 'hydrogen'
        ? { label: t.vehicleInfo.hydrogen, style: s.metaElectric }
        : specs.drive === 'hybrid'
          ? { label: t.vehicleInfo.hybrid, style: s.metaHybrid }
          : null;

  const hasChips = floorChip !== null || acChip !== null;

  return (
    <View style={s.tray}>
      <View style={s.headerRow}>
        <ModeGlyph
          mode={mode}
          color={specs.vintage ? scheme.warning : scheme.onSurfaceVariant}
        />
        <Text style={s.modelText} numberOfLines={1} ellipsizeMode="tail">
          {specs.model}
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
              <Text style={[s.chipText, floorChip.textStyle]} numberOfLines={1}>
                {floorChip.label}
              </Text>
            </View>
          ) : null}
          {acChip ? (
            <View style={[s.chip, acChip.bg]}>
              {acChip.icon}
              <Text style={[s.chipText, acChip.textStyle]} numberOfLines={1}>
                {acChip.label}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  tray: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.medium,
    paddingHorizontal: 10,
    paddingVertical: 8,
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
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: shape.small,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipLowFloor: {
    backgroundColor: scheme.secondaryContainer,
  },
  chipLowFloorText: {
    color: scheme.onSecondaryContainer,
  },
  chipPartialFloor: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  chipPartialFloorText: {
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
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '600',
  },
});
