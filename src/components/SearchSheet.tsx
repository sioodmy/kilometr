import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetFlatList,
  BottomSheetTextInput,
  TouchableOpacity,
} from '@gorhom/bottom-sheet';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, LocateFixed, MapPinOff, Search, X } from './icons';
import type { TextInput } from 'react-native-gesture-handler';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { useActiveCity } from '../services/cityStore';
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
  notice,
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
  /** Informacyjny pasek nad listą (np. „GPS poza obsługiwanym miastem"). */
  notice?: string;
}) {
  const ref = useRef<BottomSheet>(null);
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const s = useStrings();
  const { cityId } = useActiveCity();
  // Miejscownik ("w Krakowie"), nie mianownik: wchodzi po przyimku w placeholderze.
  const cityLoc = s.city.loc(cityId);
  const placeholder = placeholderProp ?? s.search.defaultPlaceholder(cityLoc);
  // Pasek nawigacji nie może zasłaniać ostatnich wyników (edge-to-edge).
  const insets = useSafeAreaInsets();

  // Stabilny ref do onClose (unikamy prze-subskrypcji przy każdym renderze)
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Android back / gest wstecz zamyka wyszukiwarkę zamiast wyjścia z apki
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [placeholder]);

  const handleClose = () => {
    inputRef.current?.blur();
    ref.current?.close();
  };

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

  const handleLineSelect = (line: TransitLine) => {
    inputRef.current?.blur();
    onSelectLine?.(line);
  };

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
  const ranked = useMemo(
    () => rankWithFrecency([...personal, ...rest], recent, trimmed),
    [personal, rest, recent, trimmed],
  );

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
      const ordered = [...recent].sort(
        (a, b) =>
          Number(b.id === '__gps') - Number(a.id === '__gps') ||
          frecency(b, now) - frecency(a, now),
      );
      append(s.search.suggestedPlaces, ordered);
      return out;
    }
    if (lines.length) {
      out.push({ type: 'header', label: s.lineTimetable.title });
      for (const line of lines) out.push({ type: 'line', line });
      hasItem = true;
    }
    append(s.search.resultsFor(trimmed, ranked.length), ranked);
    return out;
  }, [trimmed, recent, ranked, s, lines]);

  const reducedMotion = useReducedMotion();
  const lineEntering = reducedMotion
    ? undefined
    : FadeIn.duration(110).easing(Easing.out(Easing.quad));
  const lineExiting = reducedMotion ? undefined : FadeOut.duration(70);
  const lineLayout = reducedMotion
    ? undefined
    : LinearTransition.duration(120).easing(Easing.bezier(0.2, 0, 0, 1));

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

  const handleSelect = (item: Suggestion) => {
    onSelect(item);
    if (closeOnSelect) {
      inputRef.current?.blur();
      ref.current?.close();
    }
  };

  return (
    <BottomSheet
      ref={ref}
      index={0}
      snapPoints={['92%']}
      topInset={insets.top}
      bottomInset={insets.bottom}
      enableDynamicSizing={false}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onChange={(idx) => {
        if (idx === -1) {
          onClose();
        }
      }}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.head}>
        {originTitle && onChangeOrigin && (
          <TouchableOpacity
            onPress={onChangeOrigin}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
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
        )}

        <View style={[styles.inputBox, focused && styles.inputFocused]}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.leadingBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={s.search.closeA11y}
          >
            <ArrowLeft size={23} color={scheme.onSurfaceVariant} />
          </TouchableOpacity>
          <BottomSheetTextInput
            ref={inputRef}
            value={query}
            onChangeText={onQuery}
            placeholder={placeholder}
            accessibilityLabel={placeholder}
            placeholderTextColor={scheme.onSurfaceVariant}
            style={styles.input}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
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

      <BottomSheetFlatList
        data={rows}
        keyExtractor={(r: Row) =>
          r.type === 'header'
            ? r.label === s.lineTimetable.title
              ? 'h-lines'
              : r.label === s.search.suggestedPlaces
                ? 'h-suggested'
                : 'h-results'
            : r.type === 'line'
              ? `line-${r.line.routeId}`
              : r.item.id
        }
        overScrollMode="never"
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        ListHeaderComponent={
          <View style={{ gap: 6 }}>
            {notice ? (
              <View style={styles.notice}>
                <MapPinOff size={15} color={scheme.onWarningContainer} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}
            {!trimmed && savedQuick.length > 0 && (
              <View style={styles.quickRow}>
                {savedQuick.slice(0, QUICK_CHIPS).map((q) => (
                  <TouchableOpacity
                    key={q.id}
                    onPress={() => handleSelect(q)}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
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
        renderItem={({ item: row }: { item: Row }) =>
          row.type === 'header' ? (
            <Text style={styles.section} accessibilityRole="header">
              {row.label}
            </Text>
          ) : row.type === 'line' ? (
            <Animated.View
              entering={lineEntering}
              exiting={lineExiting}
              layout={lineLayout}
            >
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
          )
        }
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
              {showLoading ? (
                <ActivityIndicator color={scheme.primary} />
              ) : (
                <Search size={28} color={scheme.primary} />
              )}
            </View>
            <Text style={styles.emptyTitle}>
              {showLoading
                ? s.search.searching(cityLoc)
                : error
                  ? s.search.errorTitle
                  : trimmed
                    ? s.search.noResultsFor(trimmed)
                    : s.search.emptyTitle}
            </Text>
            {!showLoading && (
              <Text style={styles.emptySub}>
                {error
                  ? s.search.errorHint
                  : trimmed
                    ? s.search.noResultsHint(cityId)
                    : s.search.emptyHint}
              </Text>
            )}
          </View>
        }
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
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
  sheet: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
  },
  handle: { backgroundColor: scheme.outlineVariant, width: 36 },
  head: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 12 },
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
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: shape.medium,
    backgroundColor: scheme.warningContainer,
  },
  noticeText: {
    ...type.labelMedium,
    color: scheme.onWarningContainer,
    fontWeight: '600',
    flex: 1,
  },
});
