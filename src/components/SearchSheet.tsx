import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { MorphingLoader } from './MorphingLoader';
import Animated, {
  FadeIn,
  FadeOut,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, LocateFixed, MapPin, MapPinned, Search, X } from './icons';
import { motion } from '../theme/motion';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { useActiveCity } from '../services/cityStore';
import {
  getDataStatus,
  importGtfsFromNetwork,
  subscribeDataStatus,
  type DataStatus,
} from '../services/dataManager';
import type { Suggestion } from '../types/models';
import { SuggestionRow } from './SuggestionRow';
import { distanceMeters, normalizePolish } from '../gtfs/geo';
import { frecency, matchSuggestions, rankWithFrecency } from '../services/searchFrecency';
import { searchTransitLines, type TransitLine } from '../services/lineTimetable';
import { LineBadge } from './LineBadge';
import { SpringPressable } from './SpringPressable';
import type { NearbyLiveVehicle } from '../services/onboardDetector';

type Row =
  | { type: 'header'; label: string }
  | { type: 'liveMap' }
  | {
      type: 'vehicle';
      vehicle: NearbyLiveVehicle;
      first: boolean;
      last: boolean;
    }
  | { type: 'line'; line: TransitLine }
  | {
      type: 'item';
      item: Suggestion;
      first: boolean;
      last: boolean;
      prominent: boolean;
    };

const QUICK_CHIPS = 4;
const PERSONAL_MAX = 3;
/** Prefiks słowa, całe słowo albo akronim; literówki i trafienia w środku słowa zaśmiecają górę listy. */
const PERSONAL_MIN_SCORE = 85;
const SAME_PLACE_M = 60;
const MAX_RUBBER_UP = 18;

/** Arkusz wyszukiwarki M3 Expressive ze sprężystym wejściem, płynnym wyjściem i gestem ściągania. */
export function SearchSheet({
  query,
  loading,
  error = false,
  results,
  recent,
  savedQuick,
  onQuery,
  onSelect,
  onSelectLine,
  onClose,
  placeholder: placeholderProp,
  originTitle,
  onChangeOrigin,
  nearbyVehicles,
  onSelectVehicle,
  onOpenLiveMap,
  closeOnSelect = true,
}: {
  open?: boolean;
  query: string;
  loading: boolean;
  error?: boolean;
  results: Suggestion[];
  recent: Suggestion[];
  savedQuick: Suggestion[];
  onQuery: (q: string) => void;
  onSelect: (s: Suggestion) => void;
  onSelectLine?: (line: TransitLine) => void;
  onClose: () => void;
  placeholder?: string;
  originTitle?: string;
  onChangeOrigin?: () => void;
  nearbyVehicles?: NearbyLiveVehicle[];
  onSelectVehicle?: (vehicle: NearbyLiveVehicle) => void;
  onOpenLiveMap?: () => void;
  closeOnSelect?: boolean;
}) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const s = useStrings();
  const { cityId } = useActiveCity();
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  const cityLoc = s.city.loc(cityId);
  const placeholder = placeholderProp ?? s.search.defaultPlaceholder(cityLoc);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();

  const [overlayHeight, setOverlayHeight] = useState(windowHeight);
  const maxOverlayHeightRef = useRef(windowHeight);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closingRef = useRef(false);

  const baseHeight = Math.max(windowHeight, maxOverlayHeightRef.current);
  const effectiveHeight = Platform.OS === 'web' ? overlayHeight : baseHeight;
  const targetSheetHeight = Math.max(
    Platform.OS === 'web' ? 180 : 320,
    Math.round((effectiveHeight - insets.top) * 0.93),
  );
  const targetHeightRef = useRef(targetSheetHeight);
  targetHeightRef.current = targetSheetHeight;

  const translateY = useSharedValue(reducedMotion ? 0 : targetSheetHeight);
  const backdropProgress = useSharedValue(reducedMotion ? 1 : 0);
  const listScrollY = useSharedValue(0);

  const handleListScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      listScrollY.value = event.contentOffset.y;
    },
  });

  const headDividerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(listScrollY.value, [2, 18], [0, 1], 'clamp'),
  }));

  useEffect(() => {
    if (reducedMotion) {
      translateY.value = 0;
      backdropProgress.value = 1;
      return;
    }
    translateY.value = withSpring(0, motion.spring.spatialDefault);
    backdropProgress.value = withSpring(1, motion.spring.effectsDefault);
  }, [backdropProgress, reducedMotion, translateY]);

  const finishClose = useCallback(() => {
    closeRef.current();
  }, []);

  const requestClose = useCallback(
    (immediate = false) => {
      if (closingRef.current) return;
      closingRef.current = true;
      Keyboard.dismiss();
      if (immediate || reducedMotion) {
        finishClose();
        return;
      }
      cancelAnimation(translateY);
      cancelAnimation(backdropProgress);
      backdropProgress.value = withTiming(0, motion.exit);
      translateY.value = withTiming(targetHeightRef.current, motion.exit, (finished) => {
        if (finished) runOnJS(finishClose)();
      });
    },
    [backdropProgress, finishClose, reducedMotion, translateY],
  );

  useEffect(() => {
    setDataStatus(getDataStatus());
    return subscribeDataStatus(setDataStatus);
  }, []);

  // Android back / gest wstecz płynnie zamyka wyszukiwarkę zamiast wyjścia z apki.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => sub.remove();
  }, [requestClose]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Pojedynczy fallback fokusu po zakończeniu przejść nawigacji (bez podwójnego żądania IME).
  // Na webie pomijamy opóźniony focus: asynchroniczny focus po animacji powoduje na iOS Safari
  // wypchnięcie całego dokumentu do góry po wysunięciu klawiatury.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!closingRef.current && !focusedRef.current) {
        inputRef.current?.focus();
      }
    });
    return () => task.cancel();
  }, []);

  const handleOverlayLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > maxOverlayHeightRef.current) {
      maxOverlayHeightRef.current = h;
    }
    setOverlayHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  const windowShrank = maxOverlayHeightRef.current - overlayHeight > androidKeyboardHeight * 0.5;
  const extraKeyboardInset =
    Platform.OS === 'android' && androidKeyboardHeight > 0 && !windowShrank
      ? androidKeyboardHeight
      : 0;
  const keyboardOpen = Platform.OS === 'android' && (androidKeyboardHeight > 0 || windowShrank);

  const dismissPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
          'worklet';
          if (e.translationY >= 0) {
            translateY.value = e.translationY;
          } else {
            translateY.value = -Math.min(MAX_RUBBER_UP, Math.sqrt(-e.translationY) * 2.2);
          }
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationY > 96 || e.velocityY > 760) {
            if (reducedMotion) {
              runOnJS(requestClose)(true);
              return;
            }
            const remaining = Math.max(0, targetSheetHeight - Math.max(0, translateY.value));
            const speed = Math.max(1200, e.velocityY);
            const duration = Math.max(100, Math.min(180, Math.round((remaining / speed) * 1000)));
            backdropProgress.value = withTiming(0, { duration, easing: motion.exit.easing });
            translateY.value = withTiming(
              targetSheetHeight,
              { duration, easing: motion.exit.easing },
              (finished) => {
                if (finished) runOnJS(requestClose)(true);
              },
            );
          } else {
            translateY.value = withSpring(0, {
              ...motion.spring.spatialDefault,
              velocity: e.velocityY,
            });
          }
        }),
    [backdropProgress, reducedMotion, requestClose, targetSheetHeight, translateY],
  );

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    const dragFactor =
      1 - Math.min(1, Math.max(0, translateY.value) / Math.max(1, targetSheetHeight * 0.72));
    return { opacity: backdropProgress.value * dragFactor * 0.58 };
  });

  const trimmed = query.trim();
  const canSearchLines = !!onSelectLine;
  const [lineMatches, setLineMatches] = useState<{
    query: string;
    city: string;
    lines: TransitLine[];
  } | null>(null);
  const lines = useMemo(
    () => (lineMatches?.query === trimmed && lineMatches.city === cityId ? lineMatches.lines : []),
    [lineMatches, trimmed, cityId],
  );

  useEffect(() => {
    if (!canSearchLines || !trimmed) return;
    let cancelled = false;
    void searchTransitLines(trimmed)
      .then((matches) => {
        if (!cancelled) setLineMatches({ query: trimmed, city: cityId, lines: matches });
      })
      .catch(() => {
        if (!cancelled) setLineMatches(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmed, cityId, canSearchLines]);

  const handleLineSelect = useCallback(
    (line: TransitLine) => {
      onSelectLine?.(line);
      if (closeOnSelect) {
        requestClose();
      } else {
        Keyboard.dismiss();
      }
    },
    [closeOnSelect, requestClose, onSelectLine],
  );

  // Zapisane nazwy pasują od pierwszej litery, zanim odpowie lokalny indeks.
  const personal = useMemo(() => {
    if (!trimmed) return [];
    const seen = new Set<string>();
    const candidates: Suggestion[] = [];
    for (const item of [...savedQuick, ...recent]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      candidates.push(item);
    }
    const matches = matchSuggestions(trimmed, candidates);
    return rankWithFrecency(
      candidates.filter((_, index) => matches[index] >= PERSONAL_MIN_SCORE),
      recent,
      trimmed,
    ).slice(0, PERSONAL_MAX);
  }, [trimmed, savedQuick, recent]);

  const rest = useMemo(
    () =>
      results.filter(
        (r) =>
          !personal.some(
            (p) =>
              p.id === r.id ||
              (normalizePolish(p.title) === normalizePolish(r.title) &&
                distanceMeters(p.lat, p.lon, r.lat, r.lon) < SAME_PLACE_M),
          ),
      ),
    [results, personal],
  );
  const ranked = useMemo(() => {
    const ordered = rankWithFrecency([...personal, ...rest], recent, trimmed);
    const seen = new Set<string>();
    return ordered.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [personal, rest, recent, trimmed]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let hasItem = false;
    const append = (label: string, items: Suggestion[]) => {
      if (!items.length) return;
      out.push({ type: 'header', label });
      items.forEach((item, index) => {
        out.push({
          type: 'item',
          item,
          first: index === 0,
          last: index === items.length - 1,
          prominent: !!trimmed && !hasItem,
        });
        hasItem = true;
      });
    };
    if (!trimmed) {
      if (onOpenLiveMap) {
        out.push({ type: 'liveMap' });
      }
      if (nearbyVehicles && nearbyVehicles.length > 0 && onSelectVehicle) {
        const list = nearbyVehicles.slice(0, 4);
        out.push({ type: 'header', label: s.search.nearbyVehiclesSection });
        list.forEach((vehicle, index) => {
          out.push({
            type: 'vehicle',
            vehicle,
            first: index === 0,
            last: index === list.length - 1,
          });
        });
      }
      const now = Date.now();
      const seen = new Set<string>();
      const ordered = [...recent]
        .sort(
          (a, b) =>
            Number(b.id === '__gps') - Number(a.id === '__gps') ||
            frecency(b, now) - frecency(a, now),
        )
        .filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      append(s.search.suggestedPlaces, ordered);
      return out;
    }
    if (lines.length) {
      out.push({ type: 'header', label: s.lineTimetable.title });
      const seenRoutes = new Set<string>();
      for (const line of lines) {
        if (seenRoutes.has(line.routeId)) continue;
        seenRoutes.add(line.routeId);
        out.push({ type: 'line', line });
      }
      hasItem = true;
    }
    append(s.search.resultsFor(trimmed, ranked.length), ranked);
    return out;
  }, [trimmed, recent, ranked, s, lines, nearbyVehicles, onSelectVehicle, onOpenLiveMap]);

  // Opóźnienie wskaźnika ładowania o 200 ms zapobiega mignięciu przy błyskawicznych wynikach offline.
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), 200);
    return () => clearTimeout(timer);
  }, [loading]);

  const first = trimmed ? ranked[0] : undefined;

  const handleSelect = useCallback(
    (item: Suggestion) => {
      onSelect(item);
      if (closeOnSelect) {
        requestClose();
      } else {
        Keyboard.dismiss();
      }
    },
    [closeOnSelect, requestClose, onSelect],
  );

  const handleVehicleSelect = useCallback(
    (vehicle: NearbyLiveVehicle) => {
      onSelectVehicle?.(vehicle);
      if (closeOnSelect) {
        requestClose();
      } else {
        Keyboard.dismiss();
      }
    },
    [closeOnSelect, requestClose, onSelectVehicle],
  );

  const handleOpenLiveMap = useCallback(() => {
    requestClose(true);
    onOpenLiveMap?.();
  }, [requestClose, onOpenLiveMap]);

  const keyExtractor = useCallback(
    (r: Row) =>
      r.type === 'header'
        ? r.label === s.lineTimetable.title
          ? 'h-lines'
          : r.label === s.search.nearbyVehiclesSection
            ? 'h-vehicles'
            : r.label === s.search.suggestedPlaces
              ? 'h-suggested'
              : 'h-results'
        : r.type === 'liveMap'
          ? 'live-map-picker'
          : r.type === 'vehicle'
            ? `veh-${r.vehicle.vehicle.vehicleId}`
            : r.type === 'line'
              ? `line-${r.line.routeId}`
              : r.item.id,
    [s.lineTimetable.title, s.search.nearbyVehiclesSection, s.search.suggestedPlaces],
  );

  const renderRow = useCallback(
    ({ item: row }: { item: Row }) =>
      row.type === 'header' ? (
        <Text style={styles.section} accessibilityRole="header">
          {row.label}
        </Text>
      ) : row.type === 'liveMap' ? (
        <SpringPressable
          onPress={handleOpenLiveMap}
          accessibilityRole="button"
          accessibilityLabel={s.search.pickOnLiveMap}
          style={styles.liveMapRow}
          scaleDelta={0.02}
          haptic="selection"
        >
          <View style={styles.liveMapIcon}>
            <MapPinned size={20} color={scheme.onPrimaryContainer} />
          </View>
          <View style={styles.liveMapText}>
            <Text style={styles.liveMapTitle} numberOfLines={1}>
              {s.search.pickOnLiveMap}
            </Text>
            <Text style={styles.liveMapSub} numberOfLines={1}>
              {s.search.pickOnLiveMapSub}
            </Text>
          </View>
          <View style={styles.rowArrowWell}>
            <ChevronRight size={18} color={scheme.onSurfaceVariant} />
          </View>
        </SpringPressable>
      ) : row.type === 'vehicle' ? (
        <SpringPressable
          onPress={() => handleVehicleSelect(row.vehicle)}
          accessibilityRole="button"
          accessibilityLabel={
            row.vehicle.direction
              ? `${row.vehicle.line} ${s.search.vehicleDirectionTo(row.vehicle.direction)}`
              : row.vehicle.line
          }
          style={[
            styles.vehicleRow,
            row.first && styles.vehicleFirst,
            row.last && styles.vehicleLast,
          ]}
          scaleDelta={0.02}
          haptic="selection"
        >
          <LineBadge line={row.vehicle.line} mode={row.vehicle.mode} />
          <View style={styles.vehicleText}>
            <Text style={styles.vehicleTitle} numberOfLines={1}>
              {row.vehicle.direction
                ? s.search.vehicleDirectionTo(row.vehicle.direction)
                : row.vehicle.line}
            </Text>
            <Text style={styles.vehicleSub} numberOfLines={1}>
              {[
                row.vehicle.nextStopName ? s.liveMap.nextStop(row.vehicle.nextStopName) : null,
                s.liveMap.distanceAway(row.vehicle.distanceM),
              ]
                .filter(Boolean)
                .join(' \u00b7 ')}
            </Text>
          </View>
          <ChevronRight size={18} color={scheme.onSurfaceVariant} />
        </SpringPressable>
      ) : row.type === 'line' ? (
        <SpringPressable
          onPress={() => handleLineSelect(row.line)}
          accessibilityRole="button"
          accessibilityLabel={s.lineTimetable.open(row.line.shortName)}
          style={styles.lineResult}
          scaleDelta={0.02}
          haptic="selection"
        >
          <LineBadge line={row.line.shortName} mode={row.line.mode} size="large" />
          <View style={styles.lineText}>
            <Text style={styles.lineTitle}>{s.lineTimetable.line(row.line.shortName)}</Text>
            <Text style={styles.lineSubtitle} numberOfLines={2}>
              {row.line.longName || s.lineTimetable.searchHint}
            </Text>
          </View>
          <View style={styles.lineArrowWell}>
            <ChevronRight size={18} color={scheme.onSurface} />
          </View>
        </SpringPressable>
      ) : (
        <SuggestionRow
          item={row.item}
          query={trimmed}
          onSelect={handleSelect}
          segment={row.first ? (row.last ? 'single' : 'first') : row.last ? 'last' : 'middle'}
          prominent={row.prominent}
        />
      ),
    [handleLineSelect, handleOpenLiveMap, handleSelect, handleVehicleSelect, s, trimmed],
  );

  const listContentStyle = useMemo(
    () => [styles.list, { paddingBottom: keyboardOpen ? 16 : 28 + insets.bottom }],
    [keyboardOpen, insets.bottom],
  );

  const timetableSyncing =
    dataStatus.state === 'downloading' || dataStatus.state === 'importing';
  const timetableMissing = dataStatus.state === 'empty' || dataStatus.state === 'error';
  const syncLabel =
    dataStatus.state === 'downloading'
      ? s.settings.dataDownloading(Math.round(dataStatus.progress * 100))
      : dataStatus.state === 'importing'
        ? s.settings.dataStep(dataStatus.step, Math.round(dataStatus.progress * 100))
        : null;

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        { paddingTop: insets.top, paddingBottom: extraKeyboardInset },
      ]}
      onLayout={handleOverlayLayout}
      accessibilityViewIsModal
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropAnimatedStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => requestClose()}
          accessibilityRole="button"
          accessibilityLabel={s.search.closeA11y}
        />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
        pointerEvents="box-none"
      >
        <Animated.View style={[styles.sheet, { height: targetSheetHeight }, sheetAnimatedStyle]}>
          <View style={styles.container}>
            <GestureDetector gesture={dismissPanGesture}>
              <View collapsable={false}>
                <View style={styles.handleRow}>
                  <View style={styles.handle} />
                </View>
                {originTitle && onChangeOrigin && (
                  <View style={styles.originWrap}>
                    <SpringPressable
                      onPress={onChangeOrigin}
                      style={styles.originHintRow}
                      scaleDelta={0.015}
                      haptic="selection"
                      accessibilityRole="button"
                      accessibilityLabel={s.search.originA11y(originTitle)}
                    >
                      <View style={styles.originIconWell}>
                        <LocateFixed size={14} color={scheme.onPrimaryContainer} />
                      </View>
                      <Text style={styles.originHintLabel}>{s.search.fromPrefix}</Text>
                      <Text style={styles.originHintTitle} numberOfLines={1}>
                        {originTitle}
                      </Text>
                      <View style={styles.originChangePill}>
                        <Text style={styles.originHintChange}>{s.search.change}</Text>
                      </View>
                    </SpringPressable>
                  </View>
                )}
              </View>
            </GestureDetector>

            <View style={styles.head}>
              <View style={[styles.inputBox, focused && styles.inputFocused]}>
                <SpringPressable
                  onPress={() => requestClose()}
                  style={styles.leadingBtn}
                  scaleDelta={0.06}
                  haptic="selection"
                  accessibilityRole="button"
                  accessibilityLabel={s.search.closeA11y}
                >
                  <ArrowLeft size={21} color={scheme.onSurface} />
                </SpringPressable>
                <TextInput
                  ref={inputRef}
                  autoFocus
                  value={query}
                  onChangeText={onQuery}
                  placeholder={placeholder}
                  accessibilityLabel={placeholder}
                  placeholderTextColor={scheme.onSurfaceVariant}
                  style={styles.input}
                  onFocus={() => {
                    focusedRef.current = true;
                    setFocused(true);
                  }}
                  onBlur={() => {
                    focusedRef.current = false;
                    setFocused(false);
                  }}
                  selectionColor={scheme.primary}
                  returnKeyType="search"
                  autoCorrect={false}
                  autoCapitalize="none"
                  blurOnSubmit={false}
                  onSubmitEditing={() =>
                    lines[0] ? handleLineSelect(lines[0]) : first && handleSelect(first)
                  }
                />
                {query ? (
                  <Animated.View
                    entering={reducedMotion ? undefined : FadeIn.duration(120)}
                    exiting={reducedMotion ? undefined : FadeOut.duration(100)}
                  >
                    <SpringPressable
                      onPress={() => {
                        onQuery('');
                        inputRef.current?.focus();
                      }}
                      hitSlop={6}
                      style={styles.trailingBtn}
                      scaleDelta={0.08}
                      haptic="selection"
                      accessibilityRole="button"
                      accessibilityLabel={s.search.clearA11y}
                    >
                      <X size={17} color={scheme.onSurfaceVariant} />
                    </SpringPressable>
                  </Animated.View>
                ) : null}
              </View>
            </View>
            <Animated.View style={[styles.headDivider, headDividerStyle]} pointerEvents="none" />

            <Animated.FlatList
              data={rows}
              keyExtractor={keyExtractor}
              style={styles.flatList}
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              overScrollMode="never"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={listContentStyle}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              removeClippedSubviews={Platform.OS === 'android'}
              initialNumToRender={12}
              maxToRenderPerBatch={10}
              windowSize={7}
              ListHeaderComponent={
                <View style={styles.listHeader}>
                  {syncLabel && rows.length > 0 && (
                    <View style={styles.syncBanner} accessibilityLiveRegion="polite">
                      <MorphingLoader size={18} color={scheme.primary} />
                      <Text style={styles.syncBannerText}>{syncLabel}</Text>
                    </View>
                  )}
                  {!trimmed && savedQuick.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      overScrollMode="never"
                      style={styles.quickScroller}
                      contentContainerStyle={styles.quickRow}
                    >
                      {savedQuick.slice(0, QUICK_CHIPS).map((q) => (
                        <SpringPressable
                          key={q.id}
                          onPress={() => handleSelect(q)}
                          scaleDelta={0.03}
                          haptic="selection"
                          style={styles.quick}
                          accessibilityRole="button"
                          accessibilityLabel={s.search.savedA11y(q.title)}
                        >
                          <MapPin size={14} color={scheme.primary} />
                          <Text style={styles.quickText} numberOfLines={1}>
                            {q.title}
                          </Text>
                        </SpringPressable>
                      ))}
                    </ScrollView>
                  )}
                </View>
              }
              renderItem={renderRow}
              ListFooterComponent={
                showLoading && rows.length > 0 ? (
                  <View style={styles.status} accessibilityLiveRegion="polite">
                    <MorphingLoader size={18} color={scheme.primary} />
                    <Text style={styles.statusText}>{s.search.searching(cityLoc)}</Text>
                  </View>
                ) : error && rows.length > 0 ? (
                  <View style={styles.errorBanner} accessibilityRole="alert">
                    <Text style={styles.error}>{s.search.errorHint}</Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.emptyCard} accessibilityLiveRegion="polite">
                  <View style={styles.emptyIcon}>
                    {showLoading || timetableSyncing ? (
                      <MorphingLoader size={28} color={scheme.onPrimaryContainer} />
                    ) : (
                      <Search size={26} color={scheme.onPrimaryContainer} />
                    )}
                  </View>
                  <Text style={styles.emptyTitle}>
                    {syncLabel
                      ? syncLabel
                      : showLoading
                        ? s.search.searching(cityLoc)
                        : error
                          ? s.search.errorTitle
                          : timetableMissing
                            ? s.search.timetableMissingTitle
                            : trimmed
                              ? s.search.noResultsFor(trimmed)
                              : s.search.emptyTitle}
                  </Text>
                  {!showLoading && (
                    <Text style={styles.emptySub}>
                      {timetableSyncing
                        ? s.search.timetableDownloadingHint
                        : error
                          ? s.search.errorHint
                          : timetableMissing
                            ? s.search.timetableMissingHint(s.city.gen(cityId))
                            : trimmed
                              ? s.search.noResultsHint(cityId)
                              : s.search.emptyHint}
                    </Text>
                  )}
                  {timetableMissing && !showLoading && !error && (
                    <SpringPressable
                      onPress={() => void importGtfsFromNetwork().catch(() => {})}
                      scaleDelta={0.03}
                      haptic="light"
                      style={styles.downloadBtn}
                      accessibilityRole="button"
                      accessibilityLabel={s.city.downloadAction}
                    >
                      <Text style={styles.downloadBtnText}>{s.city.downloadAction}</Text>
                    </SpringPressable>
                  )}
                </View>
              }
            />
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 100,
    elevation: 24,
  },
  backdrop: {
    backgroundColor: '#000000',
  },
  kav: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '100%',
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  container: { flex: 1 },
  handleRow: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 10,
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  originWrap: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  originHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: shape.full,
    maxWidth: '100%',
    minHeight: 44,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  originIconWell: {
    width: 28,
    height: 28,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  originHintLabel: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
  },
  originHintTitle: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    fontWeight: '600',
    flex: 1,
  },
  originChangePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    flexShrink: 0,
  },
  originHintChange: {
    ...type.labelSmall,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  head: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 12 },
  headDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: scheme.outlineVariant,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
    paddingLeft: 6,
    paddingRight: 10,
    minHeight: 58,
    gap: 6,
  },
  inputFocused: {
    borderColor: scheme.primary,
  },
  leadingBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
  },
  trailingBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  input: {
    flex: 1,
    ...type.bodyLarge,
    fontWeight: '500',
    minWidth: 0,
    color: scheme.onSurface,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  flatList: { flex: 1 },
  list: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 40, gap: 3 },
  listHeader: { gap: 6 },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
    borderRadius: 18,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  syncBannerText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flex: 1,
  },
  quickScroller: {
    marginHorizontal: -16,
  },
  quickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
  },
  quick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    borderRadius: shape.full,
    paddingHorizontal: 14,
    minHeight: 42,
    maxWidth: 220,
  },
  quickText: {
    ...type.labelLarge,
    color: scheme.onSurface,
    fontWeight: '600',
    flexShrink: 1,
  },
  liveMapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 66,
    marginTop: 4,
    borderRadius: 24,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  liveMapIcon: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  liveMapText: { flex: 1, gap: 2, minWidth: 0 },
  liveMapTitle: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  liveMapSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  rowArrowWell: {
    width: 32,
    height: 32,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 64,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: 6,
  },
  vehicleFirst: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  vehicleLast: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  vehicleText: { flex: 1, gap: 2, minWidth: 0 },
  vehicleTitle: { ...type.titleSmall, fontWeight: '700', color: scheme.onSurface },
  vehicleSub: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  lineResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    minHeight: 76,
    borderRadius: 24,
    backgroundColor: scheme.primaryContainer,
    marginBottom: 4,
    ...elev.level1,
  },
  lineText: { flex: 1, gap: 3, minWidth: 0 },
  lineTitle: {
    ...type.titleMedium,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: scheme.onPrimaryContainer,
  },
  lineSubtitle: { ...type.bodySmall, color: scheme.onPrimaryContainer },
  lineArrowWell: {
    width: 34,
    height: 34,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  section: {
    ...type.labelSmall,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: scheme.onSurfaceVariant,
    paddingHorizontal: 10,
    paddingTop: 18,
    paddingBottom: 6,
  },
  emptyCard: {
    marginTop: 12,
    paddingHorizontal: 22,
    paddingVertical: 28,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    gap: 12,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...type.titleMedium,
    fontWeight: '800',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  emptySub: {
    ...type.bodyMedium,
    flexShrink: 1,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
  },
  statusText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  errorBanner: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: scheme.errorContainer,
  },
  error: {
    ...type.bodySmall,
    fontWeight: '600',
    color: scheme.onErrorContainer,
    textAlign: 'center',
  },
  downloadBtn: {
    marginTop: 4,
    minHeight: 48,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadBtnText: {
    ...type.labelLarge,
    color: scheme.onPrimary,
    fontWeight: '800',
  },
});
