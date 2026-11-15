import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, LocateFixed, Search, X } from './icons';
import { scheme, shape, type } from '../theme/tokens';
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

type Row =
  | { type: 'header'; label: string }
  | { type: 'line'; line: TransitLine }
  | {
      type: 'item';
      item: Suggestion;
      first: boolean;
      last: boolean;
      prominent: boolean;
    };

const QUICK_CHIPS = 3;
const PERSONAL_MAX = 3;
/** Prefiks słowa, całe słowo albo akronim; literówki i trafienia w środku słowa zaśmiecają górę listy. */
const PERSONAL_MIN_SCORE = 85;
const SAME_PLACE_M = 60;

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
  closeOnSelect?: boolean;
}) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const s = useStrings();
  const { cityId } = useActiveCity();
  const [dataStatus, setDataStatus] = useState<DataStatus>(() => getDataStatus());
  // Miejscownik ("w Krakowie"), nie mianownik: wchodzi po przyimku w placeholderze.
  const cityLoc = s.city.loc(cityId);
  const placeholder = placeholderProp ?? s.search.defaultPlaceholder(cityLoc);
  // Pasek nawigacji nie może zasłaniać ostatnich wyników (edge-to-edge).
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();

  const [overlayHeight, setOverlayHeight] = useState(windowHeight);
  const maxOverlayHeightRef = useRef(windowHeight);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  // Stabilny ref do onClose (unikamy prze-subskrypcji przy każdym renderze)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closingRef = useRef(false);

  const finishClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    Keyboard.dismiss();
    closeRef.current();
  }, []);

  useEffect(() => {
    setDataStatus(getDataStatus());
    return subscribeDataStatus(setDataStatus);
  }, []);

  // Android back / gest wstecz zamyka wyszukiwarkę zamiast wyjścia z apki
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      finishClose();
      return true;
    });
    return () => sub.remove();
  }, [finishClose]);

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
  useEffect(() => {
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

  const baseHeight = Math.max(windowHeight, maxOverlayHeightRef.current);
  const targetSheetHeight = Math.max(320, Math.round((baseHeight - insets.top) * 0.92));
  const windowShrank = maxOverlayHeightRef.current - overlayHeight > androidKeyboardHeight * 0.5;
  const extraKeyboardInset =
    Platform.OS === 'android' && androidKeyboardHeight > 0 && !windowShrank
      ? androidKeyboardHeight
      : 0;
  const keyboardOpen = Platform.OS === 'android' && (androidKeyboardHeight > 0 || windowShrank);

  const translateY = useSharedValue(0);

  const dismissPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(8)
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
          translateY.value = e.translationY > 0 ? e.translationY : 0;
        })
        .onEnd((e) => {
          if (e.translationY > 110 || e.velocityY > 900) {
            if (reducedMotion) {
              runOnJS(finishClose)();
              return;
            }
            translateY.value = withTiming(targetSheetHeight, { duration: 140 }, (finished) => {
              if (finished) runOnJS(finishClose)();
            });
          } else {
            translateY.value = withTiming(0, { duration: 140 });
          }
        }),
    [finishClose, reducedMotion, targetSheetHeight, translateY],
  );

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    const progress = 1 - Math.min(1, translateY.value / Math.max(1, targetSheetHeight * 0.7));
    return { opacity: progress * 0.6 };
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
        finishClose();
      } else {
        Keyboard.dismiss();
      }
    },
    [closeOnSelect, finishClose, onSelectLine],
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
  }, [trimmed, recent, ranked, s, lines]);

  const lineEntering = reducedMotion
    ? undefined
    : FadeIn.duration(110).easing(Easing.out(Easing.quad));
  const lineExiting = reducedMotion ? undefined : FadeOut.duration(70);

  // Opóźnienie wskaźnika ładowania o 200 ms: zapobiega mignięciu
  // spinnera na dole listy przy błyskawicznych (<2 ms) wyszukiwaniach offline.
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
        finishClose();
      } else {
        Keyboard.dismiss();
      }
    },
    [closeOnSelect, finishClose, onSelect],
  );

  const keyExtractor = useCallback(
    (r: Row) =>
      r.type === 'header'
        ? r.label === s.lineTimetable.title
          ? 'h-lines'
          : r.label === s.search.suggestedPlaces
            ? 'h-suggested'
            : 'h-results'
        : r.type === 'line'
          ? `line-${r.line.routeId}`
          : r.item.id,
    [s.lineTimetable.title, s.search.suggestedPlaces],
  );

  const renderRow = useCallback(
    ({ item: row }: { item: Row }) =>
      row.type === 'header' ? (
        <Text style={styles.section} accessibilityRole="header">
          {row.label}
        </Text>
      ) : row.type === 'line' ? (
        <Animated.View entering={lineEntering} exiting={lineExiting}>
          <TouchableOpacity
            onPress={() => handleLineSelect(row.line)}
            accessibilityRole="button"
            accessibilityLabel={s.lineTimetable.open(row.line.shortName)}
            activeOpacity={0.7}
            style={styles.lineResult}
          >
            <LineBadge line={row.line.shortName} mode={row.line.mode} size="large" />
            <View style={styles.lineText}>
              <Text style={styles.lineTitle}>{s.lineTimetable.line(row.line.shortName)}</Text>
              <Text style={styles.lineSubtitle}>
                {row.line.longName || s.lineTimetable.searchHint}
              </Text>
            </View>
            <ChevronRight size={22} color={scheme.onPrimaryContainer} />
          </TouchableOpacity>
        </Animated.View>
      ) : (
        <SuggestionRow
          item={row.item}
          query={trimmed}
          onPress={() => handleSelect(row.item)}
          segment={row.first ? (row.last ? 'single' : 'first') : row.last ? 'last' : 'middle'}
          prominent={row.prominent}
        />
      ),
    [handleLineSelect, handleSelect, lineEntering, lineExiting, s, trimmed],
  );

  const listContentStyle = useMemo(
    () => [styles.list, { paddingBottom: keyboardOpen ? 16 : 24 + insets.bottom }],
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
          onPress={finishClose}
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
                    <TouchableOpacity
                      onPress={onChangeOrigin}
                      style={styles.originHintRow}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={s.search.originA11y(originTitle)}
                    >
                      <LocateFixed size={16} color={scheme.onSurfaceVariant} />
                      <Text style={styles.originHintLabel}>{s.search.fromPrefix}</Text>
                      <Text style={styles.originHintTitle} numberOfLines={1}>
                        {originTitle}
                      </Text>
                      <Text style={styles.originHintChange}>{s.search.change}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </GestureDetector>

            <View style={styles.head}>
              <View style={[styles.inputBox, focused && styles.inputFocused]}>
                <TouchableOpacity
                  onPress={finishClose}
                  style={styles.leadingBtn}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={s.search.closeA11y}
                >
                  <ArrowLeft size={23} color={scheme.onSurfaceVariant} />
                </TouchableOpacity>
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
                  <TouchableOpacity
                    onPress={() => {
                      onQuery('');
                      inputRef.current?.focus();
                    }}
                    style={styles.trailingBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={s.search.clearA11y}
                  >
                    <X size={19} color={scheme.onSurfaceVariant} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <FlatList
              data={rows}
              keyExtractor={keyExtractor}
              style={styles.flatList}
              overScrollMode="never"
              contentContainerStyle={listContentStyle}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              initialNumToRender={10}
              maxToRenderPerBatch={8}
              windowSize={7}
              ListHeaderComponent={
                <View style={styles.listHeader}>
                  {syncLabel && rows.length > 0 && (
                    <View style={styles.syncBanner} accessibilityLiveRegion="polite">
                      <ActivityIndicator size="small" color={scheme.primary} />
                      <Text style={styles.syncBannerText}>{syncLabel}</Text>
                    </View>
                  )}
                  {!trimmed && savedQuick.length > 0 && (
                    <View style={styles.quickRow}>
                      {savedQuick.slice(0, QUICK_CHIPS).map((q) => (
                        <TouchableOpacity
                          key={q.id}
                          onPress={() => handleSelect(q)}
                          activeOpacity={0.7}
                          style={styles.quick}
                          accessibilityRole="button"
                          accessibilityLabel={s.search.savedA11y(q.title)}
                        >
                          <Text style={styles.quickText} numberOfLines={1}>
                            {q.title}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              }
              renderItem={renderRow}
              ListFooterComponent={
                showLoading && rows.length > 0 ? (
                  <View style={styles.status} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="small" color={scheme.primary} />
                    <Text style={styles.emptySub}>{s.search.searching(cityLoc)}</Text>
                  </View>
                ) : error && rows.length > 0 ? (
                  <Text style={styles.error} accessibilityRole="alert">
                    {s.search.errorHint}
                  </Text>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.empty} accessibilityLiveRegion="polite">
                  <View style={styles.emptyIcon}>
                    {showLoading || timetableSyncing ? (
                      <ActivityIndicator color={scheme.primary} />
                    ) : (
                      <Search size={28} color={scheme.primary} />
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
                    <TouchableOpacity
                      onPress={() => void importGtfsFromNetwork().catch(() => {})}
                      activeOpacity={0.75}
                      style={styles.downloadBtn}
                      accessibilityRole="button"
                      accessibilityLabel={s.city.downloadAction}
                    >
                      <Text style={styles.downloadBtnText}>{s.city.downloadAction}</Text>
                    </TouchableOpacity>
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
  head: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 12 },
  flatList: { flex: 1 },
  listHeader: { gap: 6 },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainer,
  },
  syncBannerText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    flex: 1,
  },
  lineResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    minHeight: 80,
    borderRadius: shape.large,
    backgroundColor: scheme.primaryContainer,
  },
  lineText: { flex: 1, gap: 4 },
  lineTitle: { ...type.titleMedium, fontWeight: '700', color: scheme.onPrimaryContainer },
  lineSubtitle: { ...type.bodySmall, color: scheme.onPrimaryContainer },
  originHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.medium,
    maxWidth: '100%',
    minHeight: 48,
    backgroundColor: scheme.surfaceContainer,
  },
  originHintLabel: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
  },
  originHintTitle: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    fontWeight: '600',
    flex: 1,
  },
  originHintChange: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '700',
    marginLeft: 2,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    borderWidth: 2,
    borderColor: scheme.outline,
    paddingLeft: 2,
    paddingRight: 4,
    minHeight: 64,
    gap: 2,
  },
  inputFocused: { borderColor: scheme.primary },
  leadingBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
  },
  trailingBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
  },
  input: {
    flex: 1,
    ...type.bodyLarge,
    minWidth: 0,
    color: scheme.onSurface,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 2 },
  section: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
    paddingHorizontal: 8,
    paddingTop: 18,
    paddingBottom: 8,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 0,
    paddingVertical: 6,
    flexWrap: 'wrap',
  },
  quick: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 48,
    maxWidth: '100%',
    justifyContent: 'center',
  },
  quickText: {
    ...type.labelLarge,
    color: scheme.onSecondaryContainer,
    fontWeight: '600',
  },
  empty: { paddingHorizontal: 16, paddingVertical: 28, alignItems: 'center', gap: 12 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: shape.large,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { ...type.titleMedium, color: scheme.onSurface, textAlign: 'center' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
  },
  error: { ...type.bodyMedium, color: scheme.error, padding: 16 },
  emptySub: {
    ...type.bodyMedium,
    flexShrink: 1,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
  },
  downloadBtn: {
    marginTop: 4,
    minHeight: 48,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadBtnText: {
    ...type.labelLarge,
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
});
