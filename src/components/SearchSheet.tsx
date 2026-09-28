import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, TextInput, View } from 'react-native';
import BottomSheet, { BottomSheetFlatList, TouchableOpacity } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, X } from 'lucide-react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { Suggestion } from '../types/models';
import { SuggestionRow } from './SuggestionRow';

export function SearchSheetHost({ children }: { children: React.ReactNode }) {
  return <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView>;
}

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
  placeholder: placeholderProp,
  originTitle,
  onChangeOrigin,
  closeOnSelect = true,
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
}) {
  const ref = useRef<BottomSheet>(null);
  const inputRef = useRef<TextInput>(null);
  const s = useStrings();
  const placeholder = placeholderProp ?? s.search.defaultPlaceholder;
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

  const hasResults = results.length > 0;

  const displayData = useMemo(() => {
    if (hasResults) return results;
    if (query.trim().length > 0) {
      const q = query.trim().toLowerCase();
      const matched = recent.filter(
        (r) => r.title.toLowerCase().includes(q) || (r.address && r.address.toLowerCase().includes(q))
      );
      if (matched.length > 0) return matched;
    }
    return recent;
  }, [hasResults, results, query, recent]);

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
            <View style={styles.originHintDot} />
            <Text style={styles.originHintLabel}>{s.search.fromPrefix}</Text>
            <Text style={styles.originHintTitle} numberOfLines={1}>
              {originTitle}
            </Text>
            <Text style={styles.originHintChange}>{s.search.change}</Text>
          </TouchableOpacity>
        )}

        {/* M3 search field z powiększonymi celami dotykowymi */}
        <View style={styles.inputBox}>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.leadingBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={s.search.closeA11y}
          >
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
            <TouchableOpacity
              onPress={() => onQuery('')}
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
        data={displayData}
        keyExtractor={(i: Suggestion, idx: number) => `${i.id}-${idx}`}
        overScrollMode="never"
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 6 }}>
            {/* Nagłówek tylko tam, gdzie coś jest */}
            {(hasResults || displayData.length > 0) && (
              <Text style={styles.section}>
                {hasResults
                  ? s.search.resultsFor(query.trim(), results.length)
                  : s.search.recentTrips}
              </Text>
            )}
            {!hasResults && query.trim().length === 0 && (
              <View style={styles.quickRow}>
                {savedQuick.map((q) => (
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
        renderItem={({ item }: { item: Suggestion }) => (
          <SuggestionRow item={item} onPress={() => handleSelect(item)} />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{loading ? s.search.searching : s.search.noResults}</Text>
            <Text style={styles.emptySub}>{s.search.noResultsHint}</Text>
          </View>
        }
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    ...elev.level3,
  },
  handle: { backgroundColor: scheme.outlineVariant, width: 44 },
  head: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, gap: 10 },
  originHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: scheme.surfaceContainerHighest,
    borderRadius: shape.full,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    minHeight: 38,
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
  leadingBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
  },
  trailingBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
  },
  input: {
    flex: 1,
    ...type.bodyLarge,
    color: scheme.onSurface,
    paddingVertical: 0,
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
  // M3 suggestion chip z ergonomicznym rozmiarem dla kciuka (minHeight: 42)
  quick: {
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 42,
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
});
