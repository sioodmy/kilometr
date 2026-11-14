import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  AcUnit,
  Accessible,
  AirlineSeatFlat,
  AirlineSeatIndividualSuite,
  DirectionsBike,
  LocalBar,
  Power,
  Restaurant,
  Usb,
  VolumeOff,
  Wifi,
} from './icons';
import { scheme } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { RailAmenity } from '../types/models';
import { loadRailAmenities, type RailAmenities as Amenities } from '../services/railAmenities';

const ICONS: Record<RailAmenity, ComponentType<{ size?: number; color?: string }>> = {
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

/** Ile ikon mieści się w rzędzie; resztę chowamy pod „+N”. */
const MAX_ICONS = 6;

/**
 * Rząd ikon udogodnień składu nad numerem pociągu w karcie połączenia.
 * Puste, dopóki dane nie wrócą z bazy albo gdy vagonweb nie zna składu.
 */
export function RailAmenities({
  tripId,
  agency,
  trainNumber,
  line,
  trainName,
}: {
  tripId?: string;
  agency?: string;
  trainNumber?: string;
  line?: string;
  trainName?: string;
}) {
  const t = useStrings();
  const [data, setData] = useState<Amenities | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    void loadRailAmenities({
      id: '',
      mode: 'train',
      fromStop: '',
      toStop: '',
      departAt: '',
      arriveAt: '',
      stopsCount: 0,
      live: false,
      tripId,
      railAgency: agency,
      trainNumber,
      line,
      trainName,
    }).then((next) => {
      if (alive) setData(next);
    });
    return () => {
      alive = false;
    };
  }, [tripId, agency, trainNumber, line, trainName]);

  if (!data || data.keys.length === 0) return null;

  const shown = data.keys.slice(0, MAX_ICONS);
  const hidden = data.keys.length - shown.length;
  const label = (key: RailAmenity) => t.railAmenities[key](data.counts[key]);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={t.railAmenities.a11y(data.keys.map(label).join(', '))}
    >
      {shown.map((key) => {
        const Icon = ICONS[key];
        return <Icon key={key} size={15} color={scheme.onSurfaceVariant} />;
      })}
      {hidden > 0 ? <Text style={styles.more}>{t.railAmenities.more(hidden)}</Text> : null}
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
