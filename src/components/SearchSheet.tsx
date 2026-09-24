import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import BottomSheet, { BottomSheetFlatList, TouchableOpacity } from '@gorhom/bottom-sheet';
import { ArrowLeft, Check, X } from 'lucide-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Suggestion } from '../types/models';
import { SuggestionRow } from './SuggestionRow';

export function SearchSheetHost({ children }: { children: React.ReactNode }) {
  return <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>;
}

const FILTERS = ['Wszystko', 'Przystanki', 'Adresy', 'Miejsca'] as const;

export function SearchSheet({
  open = true,
  query,
  loading,
  results,
  recent,
  savedQuick,
  onQuery,
  onSelect,
  onClose,
  placeholder = 'Szukaj we Wrocławiu…',
  originTitle,
  onChangeOrigin,
}: {
  open?: boolean;
  query: string;
  loading: boolean;
  results: Suggestion[];
  recent: Suggestion[];
  savedQuick: { id: string; title: string }[];
  onQuery: (q: string) => void;
  onSelect: (s: Suggestion) => void;
  onClose: () => void;
  placeholder?: string;
  originTitle?: string;
  onChangeOrigin?: () => void;
}) {
  const ref = useRef<BottomSheet>(null);
  const inputRef = useRef<TextInput>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Wszystko');

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
    setTimeout(() => inputRef.current?.focus(), 250);
  }, []);

  const handleClose = () => {
    inputRef.current?.blur();
    ref.current?.close();
  };

  const filtered = useMemo(() => {
    if (filter === 'Wszystko') return results;
    const want = filter === 'Przystanki' ? 'stop' : filter === 'Adresy' ? 'address' : 'place';
    return results.filter((r) => r.kind === want || r.kind === 'history');
  }, [results, filter]);

  const hasResults = filtered.length > 0;
  const showRecent = query.trim().length === 0 || (!hasResults && !loading);

  const displayData = useMemo(() => {
    if (hasResults) return filtered;
    if (query.trim().length > 0) {
      const q = query.trim().toLowerCase();
      const matched = recent.filter(
        (r) => r.title.toLowerCase().includes(q) || (r.address && r.address.toLowerCase().includes(q))
      );
      if (matched.length > 0) return matched;
    }
    return recent;
  }, [hasResults, filtered, query, recent]);

  const handleSelect = (item: Suggestion) => {
    onSelect(item);
    inputRef.current?.blur();
    ref.current?.close();
  };

  return (
    <BottomSheet
      ref={ref}
      index={0}
      snapPoints={['92%']}
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
            style={styles.originHintRow}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Punkt startowy: ${originTitle}. Dotknij, aby zmienić.`}
          >
            <View style={styles.originHintDot} />
            <Text style={styles.originHintLabel}>Z:</Text>
            <Text style={styles.originHintTitle} numberOfLines={1}>
              {originTitle}
            </Text>
            <Text style={styles.originHintChange}>Zmień</Text>
          </TouchableOpacity>
        )}

        {/* M3 search field */}
        <View style={styles.inputBox}>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.leadingBtn} activeOpacity={0.7}>
            <ArrowLeft size={21} color={scheme.onSurface} />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={onQuery}
            placeholder={placeholder}
            placeholderTextColor={scheme.onSurfaceVariant}
            style={styles.input}
            returnKeyType="search"
          />
          {loading ? (
            <View style={styles.trailingBtn}>
              <ActivityIndicator size="small" color={scheme.primary} />
            </View>
          ) : query ? (
            <TouchableOpacity onPress={() => onQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.trailingBtn} activeOpacity={0.7}>
              <X size={19} color={scheme.onSurfaceVariant} />
            </TouchableOpacity>
          ) : null}
        </View>
        {/* M3 filter chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} overScrollMode="never" contentContainerStyle={styles.chips}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setFilter(f)}
                activeOpacity={0.8}
                style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
              >
                {active && <Check size={15} color={scheme.onSecondaryContainer} />}
                <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{f}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <BottomSheetFlatList
        data={displayData}
        keyExtractor={(i: Suggestion, idx: number) => `${i.id}-${idx}`}
        overScrollMode="never"
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 4 }}>
            <Text style={styles.section}>
              {hasResults
                ? `Wyniki dla „${query.trim()}” (${filtered.length})`
                : 'Ostatnie przejazdy'}
            </Text>
            {!hasResults && query.trim().length === 0 && (
              <View style={styles.quickRow}>
                {savedQuick.map((q) => (
                  <View key={q.id} style={styles.quick}>
                    <Text style={styles.quickText}>{q.title}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        }
        renderItem={({ item }: { item: Suggestion }) => (
          <SuggestionRow item={item} onPress={() => handleSelect(item)} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{loading ? 'Szukam we Wrocławiu…' : 'Brak wyników'}</Text>
            <Text style={styles.emptySub}>Spróbuj: „arkady”, „biskupin”, „zoo”, „swojczycka” — działa też bez polskich znaków.</Text>
          </View>
        }
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: shape.extraLarge, borderTopRightRadius: shape.extraLarge, backgroundColor: scheme.surfaceContainer, ...elev.level3 },
  handle: { backgroundColor: scheme.outlineVariant, width: 44 },
  head: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  originHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  originHintDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: scheme.primary,
  },
  originHintLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    fontWeight: '700',
  },
  originHintTitle: {
    ...type.labelSmall,
    color: scheme.onSurface,
    fontWeight: '600',
    flexShrink: 1,
  },
  originHintChange: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '700',
    marginLeft: 2,
  },
  // M3 search view field: surfaceContainerHighest, full-width, no border
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingLeft: 4,
    paddingRight: 6,
    height: 56,
    ...elev.level1,
  },
  leadingBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: shape.full },
  trailingBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: shape.full },
  input: { flex: 1, ...type.bodyLarge, color: scheme.onSurface, paddingVertical: 0, paddingHorizontal: 4 },
  chips: { gap: 8, paddingVertical: 2 },
  // M3 filter chip: 8dp radius, 32dp height, checkmark when selected
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: shape.small, borderWidth: 1 },
  chipIdle: { borderColor: scheme.outlineVariant, backgroundColor: 'transparent' },
  chipActive: { borderColor: 'transparent', backgroundColor: scheme.secondaryContainer },
  chipText: { ...type.labelLarge },
  chipTextIdle: { color: scheme.onSurfaceVariant },
  chipTextActive: { color: scheme.onSecondaryContainer },
  list: { paddingHorizontal: 4, paddingBottom: 40, gap: 2 },
  section: { ...type.labelMedium, color: scheme.onSurfaceVariant, paddingHorizontal: 20, paddingTop: 14 },
  quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8, flexWrap: 'wrap' },
  // M3 suggestion chip
  quick: { backgroundColor: scheme.secondaryContainer, borderRadius: shape.small, paddingHorizontal: 12, paddingVertical: 8 },
  quickText: { ...type.labelLarge, color: scheme.onSecondaryContainer },
  empty: { padding: 24, alignItems: 'center', gap: 6 },
  emptyTitle: { ...type.titleMedium, color: scheme.onSurface },
  emptySub: { ...type.bodyMedium, color: scheme.onSurfaceVariant, textAlign: 'center', lineHeight: 20 },
});
