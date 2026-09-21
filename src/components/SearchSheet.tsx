import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { ArrowLeft, Check, Mic, X } from 'lucide-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Suggestion } from '../types/models';
import { SuggestionRow } from './SuggestionRow';

export function SearchSheetHost({ children }: { children: React.ReactNode }) {
  return <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>;
}

const FILTERS = ['Wszystko', 'Przystanki', 'Adresy', 'Miejsca'] as const;

export function SearchSheet({
  open,
  query,
  loading,
  results,
  recent,
  savedQuick,
  onQuery,
  onSelect,
  onClose,
}: {
  open: boolean;
  query: string;
  loading: boolean;
  results: Suggestion[];
  recent: Suggestion[];
  savedQuick: { id: string; title: string }[];
  onQuery: (q: string) => void;
  onSelect: (s: Suggestion) => void;
  onClose: () => void;
}) {
  const ref = useRef<BottomSheet>(null);
  const inputRef = useRef<TextInput>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('Wszystko');

  useEffect(() => {
    if (open) {
      ref.current?.expand();
      setTimeout(() => inputRef.current?.focus(), 250);
    } else {
      ref.current?.close();
    }
  }, [open ]);

  const filtered = useMemo(() => {
    if (filter === 'Wszystko') return results;
    const want = filter === 'Przystanki' ? 'stop' : filter === 'Adresy' ? 'address' : 'place';
    return results.filter((r) => r.kind === want || r.kind === 'history');
  }, [results, filter]);

  const showRecent = query.trim().length === 0;

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={['12%', '62%', '92%']}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.head}>
        {/* M3 search field */}
        <View style={styles.inputBox}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.leadingBtn}>
            <ArrowLeft size={21} color={scheme.onSurface} />
          </Pressable>
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={onQuery}
            placeholder="Szukaj we Wrocławiu…"
            placeholderTextColor={scheme.onSurfaceVariant}
            style={styles.input}
            returnKeyType="search"
          />
          {loading ? (
            <ActivityIndicator size="small" color={scheme.primary} />
          ) : query ? (
            <Pressable onPress={() => onQuery('')} hitSlop={10} style={styles.leadingBtn}>
              <X size={19} color={scheme.onSurfaceVariant} />
            </Pressable>
          ) : (
            <Mic size={19} color={scheme.onSurfaceVariant} />
          )}
        </View>
        {/* M3 filter chips: outlined, checkmark when selected */}
        <View style={styles.chips}>
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
              >
                {active && <Check size={15} color={scheme.onSecondaryContainer} />}
                <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextIdle]}>{f}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <BottomSheetFlatList
        data={showRecent ? recent : filtered}
        keyExtractor={(i: Suggestion) => i.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 4 }}>
            <Text style={styles.section}>{showRecent ? 'Ostatnie i zapisane' : `Wyniki dla „${query.trim()}” (${filtered.length})`}</Text>
            {showRecent && (
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
          <SuggestionRow item={item} onPress={() => onSelect(item)} />
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
  sheet: { borderTopLeftRadius: shape.extraLarge, borderTopRightRadius: shape.extraLarge, backgroundColor: scheme.surfaceContainerLow, ...elev.level3 },
  handle: { backgroundColor: scheme.outlineVariant, width: 44 },
  head: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  // M3 search view field: surfaceContainerHighest, full-width, no border
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    paddingHorizontal: 6,
    height: 56,
    ...elev.level1,
  },
  leadingBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: shape.full },
  input: { flex: 1, ...type.bodyLarge, color: scheme.onSurface },
  chips: { flexDirection: 'row', gap: 8 },
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
