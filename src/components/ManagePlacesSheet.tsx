import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  type BottomSheetFlatListMethods,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { GripVertical, MapPin, Pencil, Plus, Trash2, X } from './icons';
import { elev, scheme, shape, type } from '../theme/tokens';
import { motion } from '../theme/motion';
import { useStrings } from '../i18n';
import type { SavedPlace } from '../types/models';
import { SAVED_PLACE_ICONS } from './SavedPlacesRow';

// Musi odpowiadać gap z listContent, inaczej sloty w przeciąganiu rozjadą się z layoutem.
const GAP = 12;
const DRAG_DELAY = 120; // ms przytrzymania uchwytu zanim karta „pływa”
const EDGE_PX = 72; // strefa auto-scrollu od krawędzi listy
const SCROLL_TICK_MS = 16;
const SCROLL_STEP_PX = 9;
const LIFT_SPRING = { damping: 26, stiffness: 420, mass: 0.8, reduceMotion: ReduceMotion.System };

/** Sesja przeciągania: zwykły obiekt w refie, UI sterują shared values kart. */
type DragSession = {
  id: string;
  from: number;
  hover: number;
  startOffset: number;
  listTop: number;
  listBottom: number;
  lastTY: number;
  lastAbsY: number;
  timer: ReturnType<typeof setInterval> | null;
};

/** Wysokości kart wg kolejności + ich górne krawędzie w treści listy. */
function layoutMetrics(order: SavedPlace[], heights: Map<string, number>) {
  const h = order.map((p) => heights.get(p.id) ?? 0);
  const tops: number[] = [];
  let acc = 0;
  for (const height of h) {
    tops.push(acc);
    acc += height + GAP;
  }
  return { h, tops };
}

/** Górna krawędź slotu h po wyjęciu karty from (dziura, w którą wpadnie karta). */
function holeTop(h: number, from: number, heights: number[]): number {
  let acc = 0;
  let seen = 0;
  for (let j = 0; j < heights.length; j++) {
    if (seen >= h) break;
    if (j === from) continue;
    acc += heights[j] + GAP;
    seen++;
  }
  return acc;
}

/** Przesuw nieprzeciąganej karty j, gdy dziura jest w slotcie hover. */
function shiftFor(j: number, from: number, hover: number, dragH: number): number {
  if (j === from) return 0;
  if (from < hover) return j > from && j <= hover ? -(dragH + GAP) : 0;
  if (from > hover) return j >= hover && j < from ? dragH + GAP : 0;
  return 0;
}

/** Slot, którego dziura jest najbliżej aktualnej pozycji przeciąganej karty. */
function nearestSlot(cardTop: number, from: number, heights: number[], tops: number[]): number {
  let best = from;
  let bestDist = Math.abs(cardTop - tops[from]);
  for (let h = 0; h < heights.length; h++) {
    const dist = Math.abs(cardTop - holeTop(h, from, heights));
    if (dist < bestDist) {
      bestDist = dist;
      best = h;
    }
  }
  return best;
}

/**
 * Karta miejsca w liście zarządzania. Właściciel shared value `ty` (przesuw
 * pionowy); rodzic po rejestracji pisze do niego wprost, więc przestawianie
 * kart nie przechodzi przez re-render.
 */
function PlaceCard({
  place,
  index,
  canDrag,
  dragging,
  registerCard,
  onDragStart,
  onDragMove,
  onDragEnd,
  onLayoutHeight,
  onPressCard,
  pressLabel,
  onEdit,
  onDeleteRequest,
  onCancelDelete,
  confirming,
}: {
  place: SavedPlace;
  index: number;
  canDrag: boolean;
  dragging: boolean;
  registerCard: (id: string, ty: SharedValue<number>) => () => void;
  onDragStart: (index: number, absoluteY: number) => void;
  onDragMove: (translationY: number, absoluteY: number) => void;
  onDragEnd: (commit: boolean) => void;
  onLayoutHeight: (id: string, height: number) => void;
  onPressCard: (place: SavedPlace) => void;
  /** Etykieta a11y dotknięcia karty: zależna od trybu arkusza. */
  pressLabel: string;
  onEdit: (place: SavedPlace) => void;
  onDeleteRequest: (id: string) => void;
  onCancelDelete: () => void;
  confirming: boolean;
}) {
  const s = useStrings();
  const { fontScale } = useWindowDimensions();
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  const Icon = SAVED_PLACE_ICONS[place.icon] ?? MapPin;

  useEffect(() => registerCard(place.id, ty), [place.id, registerCard, ty]);
  useLayoutEffect(() => {
    lift.value = withSpring(dragging ? 1 : 0, LIFT_SPRING);
  }, [dragging, lift]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value }, { scale: 1 + lift.value * 0.02 }],
  }));

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canDrag)
        .activateAfterLongPress(DRAG_DELAY)
        .maxPointers(1)
        .shouldCancelWhenOutside(false)
        .runOnJS(true)
        .onStart((e) => onDragStart(index, e.absoluteY))
        .onUpdate((e) => onDragMove(e.translationY, e.absoluteY))
        .onEnd(() => onDragEnd(true))
        .onFinalize(() => onDragEnd(false)),
    [canDrag, index, onDragStart, onDragMove, onDragEnd],
  );

  return (
    <Animated.View
      style={[styles.card, animated, dragging && elev.level3, dragging && styles.dragging]}
      onLayout={(e) => onLayoutHeight(place.id, e.nativeEvent.layout.height)}
    >
      <View style={styles.placeRow}>
        <Pressable
          onPress={() => onPressCard(place)}
          accessibilityRole="button"
          accessibilityLabel={pressLabel}
          style={({ pressed }) => [styles.place, pressed && styles.pressed]}
        >
          <View style={styles.placeIcon}>
            <Icon size={22} color={scheme.onSecondaryContainer} />
          </View>
          <View style={styles.placeText}>
            <Text style={styles.name} numberOfLines={fontScale > 1.3 ? undefined : 2}>
              {place.name}
            </Text>
            <Text style={styles.address} numberOfLines={fontScale > 1.3 ? undefined : 2}>
              {place.address}
            </Text>
          </View>
        </Pressable>
        {canDrag && (
          <GestureDetector gesture={gesture}>
            <View
              style={styles.dragHandle}
              collapsable={false}
              accessibilityRole="button"
              accessibilityLabel={s.places.reorderA11y(place.name)}
            >
              <GripVertical size={20} color={scheme.onSurfaceVariant} />
            </View>
          </GestureDetector>
        )}
      </View>
      {confirming ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmText}>{s.places.removeTitle(place.name)}</Text>
          <View style={styles.actions}>
            <Pressable
              onPress={onCancelDelete}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, styles.cancelBtn, pressed && styles.pressed]}
            >
              <Text style={styles.actionText}>{s.common.cancel}</Text>
            </Pressable>
            <Pressable
              onPress={() => onDeleteRequest(place.id)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.action, styles.deleteBtn, pressed && styles.pressed]}
            >
              <Text style={styles.deleteText}>{s.places.removeConfirm}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={[styles.actions, styles.cardActions]}>
          <Pressable
            onPress={() => onEdit(place)}
            accessibilityRole="button"
            accessibilityLabel={s.places.editA11y(place.name)}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Pencil size={18} color={scheme.onSurfaceVariant} />
            <Text style={styles.actionText}>{s.places.editAction}</Text>
          </Pressable>
          <Pressable
            onPress={() => onDeleteRequest(place.id)}
            accessibilityRole="button"
            accessibilityLabel={s.places.removeA11y(place.name)}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Trash2 size={18} color={scheme.error} />
            <Text style={[styles.actionText, styles.errorText]}>{s.places.removeConfirm}</Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

export function ManagePlacesSheet({
  places,
  onClose,
  onEditPlace,
  onDeletePlace,
  onAddNew,
  onSelectPlace,
  onReorderPlaces,
}: {
  open?: boolean;
  places: SavedPlace[];
  onClose: () => void;
  onEditPlace: (place: SavedPlace) => void;
  onDeletePlace: (id: string) => void;
  onAddNew: () => void;
  onSelectPlace?: (place: SavedPlace) => void;
  /** Nowa kolejność (id) po upuszczeniu karty w innym miejscu. */
  onReorderPlaces: (orderedIds: string[]) => void;
}) {
  const sheetRef = useRef<BottomSheet>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [order, setOrder] = useState<SavedPlace[]>(places);
  // Tylko sygnał do re-renderu (lift, cień, zIndex); cała geometria w sesji.
  const [dragId, setDragId] = useState<string | null>(null);
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();

  const orderRef = useRef(order);
  orderRef.current = order;
  const heightsRef = useRef(new Map<string, number>());
  const cardsRef = useRef(new Map<string, SharedValue<number>>());
  const scrollOffsetRef = useRef(0);
  const contentHRef = useRef(0);
  const listHRef = useRef(0);
  const sessionRef = useRef<DragSession | null>(null);
  const listRef = useRef<BottomSheetFlatListMethods>(null);
  const listWrapRef = useRef<View>(null);
  const reorderRef = useRef(onReorderPlaces);
  reorderRef.current = onReorderPlaces;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Sprzątanie po karcie: sesja przeciągania nie może zostawić intervalu.
  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (session?.timer) clearInterval(session.timer);
    };
  }, []);

  // places z zewnątrz (odświeżenie po zapisie/usunięciu) przejmujemy tylko
  // poza aktywnym przeciąganiem, żeby nie rozjechać sesji.
  useEffect(() => {
    if (sessionRef.current) return;
    setOrder(places);
    const ids = new Set(places.map((p) => p.id));
    for (const id of heightsRef.current.keys()) {
      if (!ids.has(id)) heightsRef.current.delete(id);
    }
  }, [places]);

  const registerCard = useCallback((id: string, ty: SharedValue<number>) => {
    cardsRef.current.set(id, ty);
    return () => {
      if (cardsRef.current.get(id) === ty) cardsRef.current.delete(id);
    };
  }, []);

  /** Przelicza translację przeciąganej karty i ewentualnie nowy slot. */
  const applyDrag = useCallback((session: DragSession) => {
    const list = orderRef.current;
    const { h, tops } = layoutMetrics(list, heightsRef.current);
    const dy = session.lastTY + (scrollOffsetRef.current - session.startOffset);
    const cardSv = cardsRef.current.get(session.id);
    if (cardSv) cardSv.value = dy;
    const next = nearestSlot(tops[session.from] + dy, session.from, h, tops);
    if (next !== session.hover) {
      session.hover = next;
      setDragId(session.id);
      const dragH = h[session.from];
      for (let j = 0; j < list.length; j++) {
        if (j === session.from) continue;
        const sv = cardsRef.current.get(list[j].id);
        if (sv) sv.value = withTiming(shiftFor(j, session.from, next, dragH), motion.state);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, []);

  const beginDrag = useCallback(
    (index: number, absoluteY: number) => {
      if (sessionRef.current) return;
      const place = orderRef.current[index];
      if (!place) return;
      listWrapRef.current?.measureInWindow((_x, y, _w, h) => {
        if (sessionRef.current || orderRef.current[index]?.id !== place.id) return;
        const session: DragSession = {
          id: place.id,
          from: index,
          hover: index,
          startOffset: scrollOffsetRef.current,
          listTop: y,
          listBottom: y + h,
          lastTY: 0,
          lastAbsY: absoluteY,
          timer: null,
        };
        sessionRef.current = session;
        setDragId(place.id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        // Auto-scroll przy krawędziach: palec w strefie = list jedzie o krok na tick.
        session.timer = setInterval(() => {
          const cur = sessionRef.current;
          if (!cur) return;
          const dir =
            cur.lastAbsY < cur.listTop + EDGE_PX
              ? -1
              : cur.lastAbsY > cur.listBottom - EDGE_PX
                ? 1
                : 0;
          if (dir === 0) return;
          const max = Math.max(0, contentHRef.current - listHRef.current);
          const offset = Math.min(Math.max(scrollOffsetRef.current + dir * SCROLL_STEP_PX, 0), max);
          if (offset === scrollOffsetRef.current) return;
          scrollOffsetRef.current = offset;
          listRef.current?.scrollToOffset({ offset, animated: false });
          applyDrag(cur);
        }, SCROLL_TICK_MS);
      });
    },
    [applyDrag],
  );

  const moveDrag = useCallback(
    (translationY: number, absoluteY: number) => {
      const session = sessionRef.current;
      if (!session) return;
      session.lastTY = translationY;
      session.lastAbsY = absoluteY;
      applyDrag(session);
    },
    [applyDrag],
  );

  const finishDrag = useCallback((commit: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    if (session.timer) clearInterval(session.timer);

    const list = orderRef.current;
    const { h, tops } = layoutMetrics(list, heightsRef.current);
    const dy = session.lastTY + (scrollOffsetRef.current - session.startOffset);
    const drop = commit
      ? nearestSlot(tops[session.from] + dy, session.from, h, tops)
      : session.from;
    const cards = cardsRef.current;

    if (drop === session.from) {
      // Bez zmiany kolejności: wszystko wraca animacją na swoje miejsce.
      for (const p of list) {
        const sv = cards.get(p.id);
        if (sv) sv.value = withTiming(0, motion.state);
      }
      setDragId(null);
      return;
    }

    const next = [...list];
    const [moved] = next.splice(session.from, 1);
    next.splice(drop, 0, moved);

    // Flow przesuniętych kart przeskakuje dokładnie o ich dotychczasowy
    // przesuw, więc translacje zerujemy natychmiast, bez animacji.
    for (let j = 0; j < list.length; j++) {
      if (j === session.from) continue;
      const sv = cards.get(list[j].id);
      if (sv) sv.value = 0;
    }
    // Przeciągana karta: skok do starej pozycji wizualnej względem nowego
    // slotu, potem płynne dosiadanie w dziurę.
    const settle = tops[session.from] + dy - holeTop(drop, session.from, h);
    const cardSv = cards.get(session.id);
    if (cardSv) {
      cardSv.value = settle;
      cardSv.value = withTiming(0, motion.state);
    }
    setDragId(null);
    setOrder(next);
    reorderRef.current(next.map((p) => p.id));
  }, []);

  const handleLayoutHeight = useCallback((id: string, height: number) => {
    heightsRef.current.set(id, height);
  }, []);

  // Typ BottomSheetFlatList wycina `onScroll`, ale runtime łańcuchuje go przez
  // useScrollHandler; bieżący offset jest potrzebny do auto-scrollu i slotów.
  const trackScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
    if (sessionRef.current) applyDrag(sessionRef.current);
  };
  const scrollTracking = { onScroll: trackScroll };

  const handlePressCard = useCallback(
    (place: SavedPlace) => {
      if (onSelectPlace) onSelectPlace(place);
      else onEditPlace(place);
    },
    [onSelectPlace, onEditPlace],
  );

  const handleDeleteRequest = useCallback(
    (id: string) => {
      if (deletingId === id) {
        setDeletingId(null);
        onDeletePlace(id);
        return;
      }
      setDeletingId(id);
    },
    [deletingId, onDeletePlace],
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={fontScale > 1.3 ? ['96%'] : ['78%', '94%']}
      topInset={insets.top}
      bottomInset={insets.bottom}
      enableDynamicSizing={false}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={(props) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          accessibilityLabel={s.common.close}
        />
      )}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.container} accessibilityViewIsModal>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">
              {s.places.manageTitle}
            </Text>
            <Text style={styles.subtitle}>{s.places.manageSub}</Text>
          </View>
          <Pressable
            onPress={() => sheetRef.current?.close()}
            accessibilityRole="button"
            accessibilityLabel={s.common.close}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
          >
            <X size={22} color={scheme.onSurfaceVariant} />
          </Pressable>
        </View>
        <View style={styles.addSection}>
          <Pressable
            onPress={onAddNew}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
          >
            <Plus size={22} color={scheme.onPrimary} />
            <Text style={styles.addText}>{s.places.addNew}</Text>
          </Pressable>
        </View>
        <View
          ref={listWrapRef}
          style={styles.listWrap}
          onLayout={(e) => {
            listHRef.current = e.nativeEvent.layout.height;
          }}
        >
          <BottomSheetFlatList
            ref={listRef}
            data={order}
            keyExtractor={(place: SavedPlace) => place.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            overScrollMode="never"
            {...scrollTracking}
            onContentSizeChange={(_w, h) => {
              contentHRef.current = h;
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <MapPin size={32} color={scheme.primary} />
                <Text style={styles.emptyTitle}>{s.places.emptyTitle}</Text>
                <Text style={styles.emptyBody}>{s.places.emptyBody}</Text>
              </View>
            }
            renderItem={({ item, index }: { item: SavedPlace; index: number }) => (
              <PlaceCard
                place={item}
                index={index}
                canDrag={order.length > 1}
                dragging={dragId === item.id}
                confirming={deletingId === item.id}
                registerCard={registerCard}
                onDragStart={beginDrag}
                onDragMove={moveDrag}
                onDragEnd={finishDrag}
                onLayoutHeight={handleLayoutHeight}
                onPressCard={handlePressCard}
                pressLabel={
                  onSelectPlace ? s.home.searchToA11y(item.name) : s.places.editA11y(item.name)
                }
                onEdit={onEditPlace}
                onDeleteRequest={handleDeleteRequest}
                onCancelDelete={() => setDeletingId(null)}
              />
            )}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheet: {
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
  },
  handle: { backgroundColor: scheme.outlineVariant, width: 36 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  headerText: { flex: 1, gap: 6 },
  title: { ...type.headlineSmall, fontWeight: '500', color: scheme.onSurface },
  subtitle: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  closeBtn: {
    width: 48,
    height: 48,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listWrap: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  card: {
    padding: 16,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerHigh,
    gap: 12,
  },
  dragging: { zIndex: 10 },
  placeRow: { flexDirection: 'row', alignItems: 'center' },
  place: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, flex: 1 },
  dragHandle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -10,
  },
  placeIcon: {
    width: 44,
    height: 44,
    borderRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeText: { flex: 1, gap: 4 },
  name: { ...type.bodyLarge, fontWeight: '500', color: scheme.onSurface },
  address: { ...type.bodyMedium, color: scheme.onSurfaceVariant },
  actions: { flexDirection: 'row', gap: 10 },
  cardActions: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  action: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 10,
    borderRadius: shape.medium,
  },
  actionText: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
    textAlign: 'center',
  },
  errorText: { color: scheme.error },
  confirm: { gap: 12 },
  confirmText: { ...type.bodyLarge, color: scheme.onSurface },
  cancelBtn: { backgroundColor: scheme.surfaceContainerHighest },
  deleteBtn: { backgroundColor: scheme.error },
  deleteText: { ...type.labelLarge, color: scheme.onError, flexShrink: 1, textAlign: 'center' },
  empty: { paddingHorizontal: 12, paddingVertical: 28, gap: 16, alignItems: 'center' },
  emptyTitle: { ...type.titleLarge, color: scheme.onSurface, textAlign: 'center' },
  emptyBody: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center' },
  addSection: { paddingHorizontal: 20, paddingBottom: 16 },
  addBtn: {
    minHeight: 56,
    padding: 16,
    borderRadius: shape.large,
    backgroundColor: scheme.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  addText: { ...type.labelLarge, color: scheme.onPrimary, flexShrink: 1, textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
