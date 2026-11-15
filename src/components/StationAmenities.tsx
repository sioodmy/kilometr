import { useEffect, useState } from 'react';
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
import { scheme } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { StationAmenity } from '../types/models';
import { loadStationAmenities } from '../services/stationAmenities';

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

/**
 * Rząd ikon udogodnień dworca (OSM 50 m) pod nazwą stacji przyjazdu w karcie pociągu.
 * Puste, dopóki dane nie wrócą z bazy albo gdy brak udogodnień w pobliżu.
 */
export function StationAmenities({
  stopId,
  lat,
  lon,
}: {
  stopId?: string;
  lat?: number;
  lon?: number;
}) {
  const t = useStrings();
  const [keys, setKeys] = useState<StationAmenity[] | null>(null);

  useEffect(() => {
    let alive = true;
    setKeys(null);
    void loadStationAmenities(stopId, lat, lon).then((next) => {
      if (alive) setKeys(next);
    });
    return () => {
      alive = false;
    };
  }, [stopId, lat, lon]);

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
      {shown.map((key) => {
        const Icon = ICONS[key];
        return <Icon key={key} size={15} color={scheme.onSurfaceVariant} />;
      })}
      {hidden > 0 ? <Text style={styles.more}>{t.stationAmenities.more(hidden)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    minHeight: 20,
  },
  more: {
    fontSize: 11,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
});
