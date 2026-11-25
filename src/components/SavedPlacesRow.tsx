import React, { memo, useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import {
  Baby,
  Beer,
  Bike,
  Briefcase,
  BusFront,
  CarFront,
  ChevronRight,
  Church,
  Clapperboard,
  Coffee,
  Compass,
  CreditCard,
  Dumbbell,
  Fuel,
  Gamepad2,
  GraduationCap,
  Heart,
  Home,
  Hospital,
  Hotel,
  Landmark,
  Laptop,
  Library,
  MapPin,
  Mountain,
  Music,
  Package,
  PawPrint,
  Pill,
  Pizza,
  Plane,
  Plus,
  Restaurant,
  Sandwich,
  Scissors,
  Ship,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Tent,
  Theater,
  Ticket,
  Train,
  TramFront,
  Trees,
  Trophy,
  University,
  Users,
  Waves,
  Wine,
  type IconComponent,
} from './icons';
import { SpringPressable } from './SpringPressable';
import { LineBadge } from './LineBadge';
import { formatDepartIn, type SmartLineBadge } from './SmartHistoryList';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SavedPlace, SavedPlaceIcon } from '../types/models';
import { placeIconTone } from '../services/placeIcons';
import { useStrings } from '../i18n';

export const SAVED_PLACE_ICONS: Record<SavedPlaceIcon, IconComponent> = {
  home: Home,
  school: GraduationCap,
  work: Briefcase,
  gym: Dumbbell,
  star: Star,
  heart: Heart,
  coffee: Coffee,
  shopping: ShoppingBag,
  train: Train,
  mapPin: MapPin,
  plus: Plus,
  restaurant: Restaurant,
  pharmacy: Pill,
  park: Trees,
  cinema: Clapperboard,
  culture: Landmark,
  library: Library,
  friends: Users,
  church: Church,
  car: CarFront,
  bike: Bike,
  plane: Plane,
  market: Store,
  university: University,
  tram: TramFront,
  bus: BusFront,
  fuel: Fuel,
  ship: Ship,
  compass: Compass,
  pizza: Pizza,
  sandwich: Sandwich,
  beer: Beer,
  wine: Wine,
  cart: ShoppingCart,
  hospital: Hospital,
  doctor: Stethoscope,
  scissors: Scissors,
  sparkles: Sparkles,
  theater: Theater,
  music: Music,
  ticket: Ticket,
  gamepad: Gamepad2,
  mountain: Mountain,
  tent: Tent,
  trophy: Trophy,
  swimming: Waves,
  baby: Baby,
  pet: PawPrint,
  hotel: Hotel,
  bank: CreditCard,
  post: Package,
  laptop: Laptop,
};

/** Wspólne wymiary kafla: stała wysokość gwarantuje zlicowanie treści między kartami. */
function tileMetrics(width: number, fontScale: number) {
  const scale = Math.max(1, Math.min(fontScale, 1.35));
  return {
    height: Math.round(138 * scale),
    width: Math.min(width - 56, Math.round(172 * scale)),
    textLines: fontScale > 1.2 ? 2 : 1,
  };
}

interface SavedPlaceCardProps {
  place: SavedPlace;
  tileHeight: number;
  tileWidth?: number;
  flexGrid?: boolean;
  desktopGrid?: boolean;
  textLines: number;
  departInMin?: number;
  badge?: SmartLineBadge;
  onSelect: (p: SavedPlace) => void;
  onEdit?: (p: SavedPlace) => void;
}

/** Kafelek miejsca M3 Expressive: liściasty znaczek u góry, nazwa i odjazd na dole. */
const SavedPlaceCard = memo(function SavedPlaceCard({
  place,
  tileHeight,
  tileWidth,
  flexGrid,
  desktopGrid,
  textLines,
  departInMin,
  badge,
  onSelect,
  onEdit,
}: SavedPlaceCardProps) {
  const s = useStrings();
  const [focused, setFocused] = useState(false);
  const Icon = SAVED_PLACE_ICONS[place.icon] ?? Star;
  const tone = placeIconTone(place.icon);
  const departLabel = formatDepartIn(departInMin, s);
  const urgent = departInMin !== undefined && departInMin >= 0 && departInMin <= 5;
  const shortAddress = place.address.split(',')[0].trim();

  return (
    <SpringPressable
      onPress={() => onSelect(place)}
      accessibilityRole="button"
      accessibilityLabel={s.home.searchToA11y(place.name)}
      accessibilityHint={onEdit ? s.home.editPlaceHint : undefined}
      onLongPress={onEdit ? () => onEdit(place) : undefined}
      delayLongPress={300}
      accessibilityActions={
        onEdit ? [{ name: 'edit', label: s.places.editA11y(place.name) }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'edit') onEdit?.(place);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      scaleDelta={0.025}
      haptic="selection"
      style={[
        styles.tile,
        desktopGrid
          ? styles.tileDesktopGrid
          : flexGrid
            ? styles.tileFlex
            : { width: tileWidth },
        { height: tileHeight },
        focused && styles.focused,
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: scheme[tone.bg] }]}>
        <Icon size={22} color={scheme[tone.fg]} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.name} numberOfLines={textLines}>
          {place.name}
        </Text>
        <View style={styles.metaSlot}>
          {departLabel ? (
            <View style={[styles.livePill, urgent && styles.livePillUrgent]}>
              {badge?.line ? <LineBadge mode={badge.mode} line={badge.line} compact /> : null}
              <Text
                style={[styles.liveText, urgent && styles.liveTextUrgent]}
                numberOfLines={1}
              >
                {departLabel}
              </Text>
            </View>
          ) : (
            <Text style={styles.addr} numberOfLines={1}>
              {shortAddress}
            </Text>
          )}
        </View>
      </View>
    </SpringPressable>
  );
});

interface AddTileProps {
  tileHeight: number;
  tileWidth?: number;
  flexGrid?: boolean;
  desktopGrid?: boolean;
  onAdd: () => void;
}

/** Kafelek „Dodaj”: otwarty slot z przerywanym konturem, ten sam rytm co zapisane miejsca. */
const AddTile = memo(function AddTile({
  tileHeight,
  tileWidth,
  flexGrid,
  desktopGrid,
  onAdd,
}: AddTileProps) {
  const s = useStrings();
  const [focused, setFocused] = useState(false);

  return (
    <SpringPressable
      onPress={onAdd}
      accessibilityRole="button"
      accessibilityLabel={s.places.addNew}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      scaleDelta={0.025}
      haptic="selection"
      style={[
        styles.tile,
        styles.tileAdd,
        desktopGrid
          ? styles.tileDesktopGrid
          : flexGrid
            ? styles.tileFlex
            : { width: tileWidth },
        { height: tileHeight },
        focused && styles.focused,
      ]}
    >
      <View style={[styles.iconBox, styles.iconBoxAdd]}>
        <Plus size={22} color={scheme.onSecondaryContainer} />
      </View>
      <View style={styles.footer}>
        <Text style={styles.nameAdd} numberOfLines={1}>
          {s.places.addShort}
        </Text>
        <View style={styles.metaSlot} />
      </View>
    </SpringPressable>
  );
});

export const SavedPlacesRow = memo(function SavedPlacesRow({
  places,
  departures,
  lineBadges,
  onSelect,
  onAdd,
  onEdit,
  desktopGrid = false,
}: {
  places: SavedPlace[];
  /** Najszybszy odjazd do miejsca w minutach, kluczem placeId. */
  departures?: Record<string, number | undefined>;
  /** Pierwsza linia do miejsca, kluczem placeId. */
  lineBadges?: Record<string, SmartLineBadge | undefined>;
  onSelect: (p: SavedPlace) => void;
  onAdd: () => void;
  onEdit?: (p: SavedPlace) => void;
  desktopGrid?: boolean;
}) {
  const s = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const [focusedAdd, setFocusedAdd] = useState(false);
  const metrics = tileMetrics(width, fontScale);

  const handleSelect = useCallback(
    (p: SavedPlace) => {
      onSelect(p);
    },
    [onSelect],
  );

  if (places.length === 0) {
    return (
      <SpringPressable
        onPress={onAdd}
        onFocus={() => setFocusedAdd(true)}
        onBlur={() => setFocusedAdd(false)}
        accessibilityRole="button"
        accessibilityLabel={s.places.addNew}
        scaleDelta={0.02}
        haptic="selection"
        style={[styles.emptyCard, focusedAdd && styles.focused]}
      >
        <View style={[styles.iconBox, styles.iconBoxEmpty]}>
          <Plus size={22} color={scheme.onPrimaryContainer} />
        </View>
        <View style={styles.emptyText}>
          <Text style={styles.emptyTitle}>{s.places.addNew}</Text>
          <Text style={styles.emptyBody}>{s.places.emptyBody}</Text>
        </View>
        <View style={styles.emptyArrow}>
          <ChevronRight size={18} color={scheme.onSurfaceVariant} />
        </View>
      </SpringPressable>
    );
  }

  if (desktopGrid) {
    return (
      <View style={styles.desktopGrid}>
        {places.map((p) => (
          <SavedPlaceCard
            key={p.id}
            place={p}
            desktopGrid
            tileHeight={metrics.height}
            textLines={metrics.textLines}
            departInMin={departures?.[p.placeId]}
            badge={lineBadges?.[p.placeId]}
            onSelect={handleSelect}
            onEdit={onEdit}
          />
        ))}
        <AddTile desktopGrid tileHeight={metrics.height} onAdd={onAdd} />
      </View>
    );
  }

  if (places.length <= 2) {
    // Do dwóch miejsc: siatka na całą szerokość, bez przewijania.
    return (
      <View style={styles.gridRow}>
        {places.map((p) => (
          <SavedPlaceCard
            key={p.id}
            place={p}
            flexGrid
            tileHeight={metrics.height}
            textLines={metrics.textLines}
            departInMin={departures?.[p.placeId]}
            badge={lineBadges?.[p.placeId]}
            onSelect={handleSelect}
            onEdit={onEdit}
          />
        ))}
        {places.length < 2 && (
          <AddTile flexGrid tileHeight={metrics.height} onAdd={onAdd} />
        )}
      </View>
    );
  }

  const { height, width: tileWidth, textLines } = metrics;

  return (
    <ScrollView
      style={styles.scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      overScrollMode="never"
      contentContainerStyle={styles.scrollRow}
      snapToInterval={tileWidth + 10}
      decelerationRate="fast"
      snapToAlignment="start"
    >
      {places.map((p) => (
        <SavedPlaceCard
          key={p.id}
          place={p}
          tileWidth={tileWidth}
          tileHeight={height}
          textLines={textLines}
          departInMin={departures?.[p.placeId]}
          badge={lineBadges?.[p.placeId]}
          onSelect={handleSelect}
          onEdit={onEdit}
        />
      ))}
      <AddTile tileWidth={tileWidth} tileHeight={height} onAdd={onAdd} />
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  gridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  desktopGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 12,
  },
  scroller: {
    flexGrow: 0,
    flexShrink: 0,
    marginHorizontal: -16,
  },
  scrollRow: {
    gap: 10,
    paddingHorizontal: 16,
  },
  tile: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 15,
    justifyContent: 'space-between',
    ...elev.level1,
  },
  tileFlex: {
    flex: 1,
    minWidth: 0,
  },
  tileDesktopGrid: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 190,
    maxWidth: 260,
  },
  tileAdd: {
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: scheme.outlineVariant,
    elevation: 0,
    shadowOpacity: 0,
  },
  iconBox: {
    width: 46,
    height: 46,
    borderRadius: 22,
    borderTopRightRadius: 10,
    borderBottomLeftRadius: 10,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  iconBoxAdd: {
    backgroundColor: scheme.secondaryContainer,
  },
  iconBoxEmpty: {
    backgroundColor: scheme.primaryContainer,
  },
  footer: {
    gap: 7,
  },
  name: {
    ...type.titleMedium,
    fontWeight: '700',
    letterSpacing: -0.25,
    color: scheme.onSurface,
  },
  nameAdd: {
    ...type.titleMedium,
    fontWeight: '700',
    letterSpacing: -0.25,
    color: scheme.onSurfaceVariant,
  },
  metaSlot: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
  },
  addr: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  livePill: {
    height: 28,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  livePillUrgent: {
    backgroundColor: scheme.primaryContainer,
  },
  liveText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  liveTextUrgent: {
    color: scheme.onPrimaryContainer,
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    backgroundColor: scheme.surfaceContainer,
    ...elev.level1,
  },
  emptyText: { flex: 1, gap: 3, minWidth: 0 },
  emptyTitle: { ...type.titleMedium, fontWeight: '700', color: scheme.onSurface },
  emptyBody: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  emptyArrow: {
    width: 34,
    height: 34,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  focused: { borderWidth: 1.5, borderColor: scheme.primary },
});
