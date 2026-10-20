import { useEffect, useMemo, useRef } from 'react';
import { usePredictiveBackBlocker } from './usePredictiveBackBlocker';
import { ActivityIndicator, BackHandler, StyleSheet, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetFlatList,
  BottomSheetTextInput,
  TouchableOpacity,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, LocateFixed, MapPinOff, Search, X } from 'lucide-react-native';
import type { TextInput } from 'react-native-gesture-handler';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import { useActiveCity } from '../services/cityStore';
import type { Suggestion } from '../types/models';
import { SuggestionRow } from './SuggestionRow';
import { fuzzyMatch } from '../gtfs/fuzzy';
import { distanceMeters, normalizePolish } from '../gtfs/geo';

type Row = { type: 'header'; label: string } | { type: 'item'; item: Suggestion };

const QUICK_CHIPS = 3;
const PERSONAL_MAX = 3;
/** Prefiks słowa, całe słowo albo akronim; literówki i trafienia w środku słowa zaśmiecają górę listy. */
const PERSONAL_MIN_SCORE = 85;
const SAME_PLACE_M = 60;

export function SearchSheet({
  query,
  loading,
  results,
  recent,
  savedQuick,
  onQuery,
  onSelect,
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
  results: Suggestion[];
  recent: Suggestion[];
  savedQuick: Suggestion[];
  onQuery: (q: string) => void;
  onSelect: (s: Suggestion) => void;
  onClose: () => void;
  placeholder?: string;
  originTitle?: string;
  onChangeOrigin?: () => void;
  closeOnSelect?: boolean;
  /** Informacyjny pasek nad listą (np. „GPS poza obsługiwanym miastem"). */
  notice?: string;
}) {
  usePredictiveBackBlocker();
  const ref = useRef<BottomSheet>(null);
  const inputRef = useRef<TextInput>(null);
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

  // Zapisane miejsca i historia pasujące do zapytania idą przed wyniki z bazy:
  // „d” od razu podsuwa „Dom”, zanim sieć cokolwiek zwróci.
  const personal = useMemo(() => {
    if (!trimmed) return [];
    const seen = new Set<string>();
    const scored: { item: Suggestion; score: number }[] = [];
    for (const item of [...savedQuick, ...recent]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const score = Math.max(
        fuzzyMatch(trimmed, item.title).score,
        item.address ? fuzzyMatch(trimmed, item.address).score - 20 : 0,
      );
      if (score >= PERSONAL_MIN_SCORE) scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, PERSONAL_MAX).map((x) => x.item);
  }, [trimmed, savedQuick, recent]);

  const rest = useMemo(
    () =>
      results.filter(
        (r) =>
          !personal.some(
            (p) =>
              normalizePolish(p.title) === normalizePolish(r.title) ||
              distanceMeters(p.lat, p.lon, r.lat, r.lon) < SAME_PLACE_M,
          ),
      ),
    [results, personal],
  );

  const rows = useMemo<Row[]>(() => {
    if (!trimmed) {
      return recent.length
        ? [
            { type: 'header', label: s.search.recentTrips },
            ...recent.map((item) => ({ type: 'item' as const, item })),
          ]
        : [];
    }
    const out: Row[] = [];
    if (personal.length) {
      out.push({ type: 'header', label: s.search.yourPlaces });
      for (const item of personal) out.push({ type: 'item', item });
    }
    if (rest.length) {
      out.push({ type: 'header', label: s.search.resultsFor(trimmed, rest.length) });
      for (const item of rest) out.push({ type: 'item', item });
    }
    return out;
  }, [trimmed, recent, personal, rest, s]);

  const first = trimmed ? (personal[0] ?? rest[0]) : undefined;

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

        <View style={styles.searchRow}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.leadingBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={s.search.closeA11y}
          >
            <ArrowLeft size={23} color={scheme.onSurface} />
          </TouchableOpacity>
          <View style={styles.inputBox}>
            <Search size={20} color={scheme.onSurfaceVariant} />
            <BottomSheetTextInput
              ref={inputRef}
              value={query}
              onChangeText={onQuery}
              placeholder={placeholder}
              accessibilityLabel={placeholder}
              placeholderTextColor={scheme.onSurfaceVariant}
              style={styles.input}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
              blurOnSubmit={false}
              onSubmitEditing={() => first && handleSelect(first)}
            />
            {loading && (
              <ActivityIndicator size="small" color={scheme.primary} style={styles.spinner} />
            )}
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
      </View>

      <BottomSheetFlatList
        data={rows}
        keyExtractor={(r: Row, idx: number) =>
          r.type === 'header' ? `h-${r.label}` : `${r.item.id}-${idx}`
        }
        overScrollMode="never"
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
            <Text style={styles.section}>{row.label}</Text>
          ) : (
            <SuggestionRow item={row.item} query={trimmed} onPress={() => handleSelect(row.item)} />
          )
        }
        ListEmptyComponent={
          trimmed ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                {loading ? s.search.searching(cityLoc) : s.search.noResultsFor(trimmed)}
              </Text>
              {!loading && <Text style={styles.emptySub}>{s.search.noResultsHint(cityId)}</Text>}
            </View>
          ) : null
        }
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
  },
  handle: { backgroundColor: scheme.outlineVariant, width: 36 },
  head: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, gap: 12 },
  originHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: shape.medium,
    maxWidth: '100%',
    minHeight: 48,
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
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingLeft: 14,
    paddingRight: 4,
    minHeight: 56,
    gap: 6,
  },
  leadingBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
  },
  spinner: { marginHorizontal: 4 },
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
    color: scheme.onSurface,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  list: { paddingHorizontal: 4, paddingBottom: 40, gap: 2 },
  section: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    flexWrap: 'wrap',
  },
  quick: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.medium,
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
  empty: { padding: 24, alignItems: 'center', gap: 6 },
  emptyTitle: { ...type.titleMedium, color: scheme.onSurface },
  emptySub: {
    ...type.bodyMedium,
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
