import { memo, startTransition, useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  BakeryDining,
  Coffee,
  LocalAtm,
  LocalPharmacy,
  Luggage,
  Restaurant,
  ShoppingBag,
  Wc,
} from './icons';
import { SkeletonBone, SkeletonPulse } from './SkeletonPulse';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { StationAmenity } from '../types/models';
import { getCachedStationAmenities, loadStationAmenities } from '../services/stationAmenities';
import { waitForUiScrollIdle } from '../services/routing/yieldFrame';

const ICONS: Record<StationAmenity, ComponentType<{ size?: number; color?: string }>> = {
  toilets: Wc,
  gastronomy: Restaurant,
  shop: ShoppingBag,
  cafe: Coffee,
  bakery: BakeryDining,
  pharmacy: LocalPharmacy,
  atm: LocalAtm,
  luggage: Luggage,
};

/** Ile ikon mieści się w rzędzie; resztę chowamy pod „+N”. */
const MAX_ICONS = 6;

const MOCK_ICON_COUNT = 5;

/**
 * Rząd ikon udogodnień dworca (OSM 50 m) pod nazwą stacji przyjazdu w karcie pociągu.
 * Podczas ładowania pokazuje lekki mock rząd w stanie ładowania,
 * a gdy stacja nie ma udogodnień zwraca null.
 */
export const StationAmenities = memo(function StationAmenities({
  stopId,
  lat,
  lon,
  showLabel = false,
  deferLoad = false,
  deferGraphics = false,
}: {
  stopId?: string;
  lat?: number;
  lon?: number;
  showLabel?: boolean;
  deferLoad?: boolean;
  deferGraphics?: boolean;
}) {
  const t = useStrings();
  const [state, setState] = useState<{ keys: StationAmenity[] | null; loading: boolean }>(() => {
    const cached = getCachedStationAmenities(stopId, lat, lon);
    if (cached !== undefined) return { keys: cached, loading: false };
    return { keys: null, loading: true };
  });

  useEffect(() => {
    let alive = true;
    const cached = getCachedStationAmenities(stopId, lat, lon);
    if (cached !== undefined) {
      setState((prev) =>
        prev.keys === cached && !prev.loading ? prev : { keys: cached, loading: false },
      );
      return;
    }
    setState((prev) =>
      prev.keys === null && prev.loading ? prev : { keys: null, loading: true },
    );
    if (deferLoad) return;
    void loadStationAmenities(stopId, lat, lon).then(async (next) => {
      await waitForUiScrollIdle(450);
      if (!alive) return;
      startTransition(() => {
        setState({ keys: next, loading: false });
      });
    });
    return () => {
      alive = false;
    };
  }, [stopId, lat, lon, deferLoad]);

  const { keys, loading } = state;
  const showSkeleton = loading || (deferGraphics && deferLoad && Boolean(keys && keys.length > 0));

  if (showSkeleton) {
    const iconCount = keys ? Math.min(MAX_ICONS, keys.length) : MOCK_ICON_COUNT;
    return (
      <SkeletonPulse style={styles.row}>
        {showLabel ? <SkeletonBone width={78} height={11} radius={5} /> : null}
        <View style={styles.iconsGroup}>
          {Array.from({ length: iconCount }, (_, idx) => (
            <SkeletonBone key={idx} width={14} height={14} radius={shape.full} />
          ))}
        </View>
      </SkeletonPulse>
    );
  }

  if (!keys || keys.length === 0) return null;

  const shown = keys.slice(0, MAX_ICONS);
  const hidden = keys.length - shown.length;
  const label = (key: StationAmenity) => t.stationAmenities[key];

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={t.stationAmenities.a11y(keys.map(label).join(', '))}
    >
      {showLabel ? (
        <Text style={styles.summary} numberOfLines={1}>
          {t.stationAmenities.summary(keys.length)}
        </Text>
      ) : null}
      <View style={styles.iconsGroup}>
        {shown.map((key) => {
          const Icon = ICONS[key];
          return <Icon key={key} size={14} color={scheme.onSurfaceVariant} />;
        })}
        {hidden > 0 ? <Text style={styles.more}>{t.stationAmenities.more(hidden)}</Text> : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    minHeight: 20,
  },
  summary: {
    ...type.labelSmall,
    fontSize: 12,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  iconsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  more: {
    ...type.labelSmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
});
