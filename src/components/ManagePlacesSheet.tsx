import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BottomSheet, { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapPin,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from 'lucide-react-native';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { SavedPlace } from '../types/models';
import { SAVED_PLACE_ICONS } from './SavedPlacesRow';

export function ManagePlacesSheet({
  open = true,
  places,
  onClose,
  onEditPlace,
  onDeletePlace,
  onAddNew,
  onSelectPlace,
}: {
  open?: boolean;
  places: SavedPlace[];
  onClose: () => void;
  onEditPlace: (place: SavedPlace) => void;
  onDeletePlace: (id: string) => void;
  onAddNew: () => void;
  onSelectPlace?: (place: SavedPlace) => void;
}) {
  const sheetRef = useRef<BottomSheet>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Arkusz leży na spodzie ekranu (edge-to-edge), więc pasek nawigacji
  // zasłania ostatnią pozycję listy i przycisk „Dodaj miejsce”.
  const insets = useSafeAreaInsets();

  // Android back / gest wstecz zamyka sheet zamiast wyjścia z apki
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  const handleClose = () => {
    sheetRef.current?.close();
  };

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={['65%', '92%']}
      bottomInset={insets.bottom}
      enableDynamicSizing={false}
      enablePanDownToClose
      onChange={(idx) => {
        if (idx === -1) onClose();
      }}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>Zapisane miejsca</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countText}>{places.length}</Text>
              </View>
            </View>
            <Text style={styles.subtitle}>
              Zarządzaj swoimi szybkimi celami podróży
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={onAddNew}
              hitSlop={8}
              style={({ pressed }) => [styles.headerAddBtn, pressed && { opacity: 0.7 }]}
            >
              <Plus size={18} color={scheme.primary} />
            </Pressable>
            <Pressable
              onPress={handleClose}
              hitSlop={8}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
            >
              <X size={20} color={scheme.onSurfaceVariant} />
            </Pressable>
          </View>
        </View>

        {/* Places List */}
        {places.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconWrap}>
              <Star size={32} color={scheme.onSurfaceVariant} />
            </View>
            <Text style={styles.emptyTitle}>Brak zapisanych miejsc</Text>
            <Text style={styles.emptySubtitle}>
              Dodaj dom, pracę lub ulubione punkty, aby jednym dotknięciem sprawdzać połączenia.
            </Text>
            <Pressable
              onPress={onAddNew}
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
            >
              <Plus size={20} color={scheme.onPrimary} />
              <Text style={styles.addBtnText}>Dodaj nowe miejsce</Text>
            </Pressable>
          </View>
        ) : (
          <BottomSheetFlatList
            data={places}
            keyExtractor={(item: SavedPlace, index: number) => `${item.id}-${index}`}
            overScrollMode="never"
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={
              <Pressable
                onPress={onAddNew}
                style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
              >
                <Plus size={20} color={scheme.onPrimary} />
                <Text style={styles.addBtnText}>Dodaj nowe miejsce</Text>
              </Pressable>
            }
            renderItem={({ item }: { item: SavedPlace }) => {
              const Icon = SAVED_PLACE_ICONS[item.icon] ?? MapPin;
              const isConfirming = deletingId === item.id;

              if (isConfirming) {
                return (
                  <View style={styles.confirmRow}>
                    <View style={styles.confirmLeft}>
                      <Trash2 size={18} color={scheme.error} />
                      <Text style={styles.confirmText} numberOfLines={1}>
                        Usunąć „{item.name}”?
                      </Text>
                    </View>
                    <View style={styles.confirmActions}>
                      <Pressable
                        onPress={() => setDeletingId(null)}
                        style={({ pressed }) => [styles.cancelInlineBtn, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.cancelInlineText}>Nie</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setDeletingId(null);
                          onDeletePlace(item.id);
                        }}
                        style={({ pressed }) => [styles.deleteInlineBtn, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.deleteInlineText}>Usuń</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }

              return (
                <View style={styles.placeItem}>
                  <View style={styles.itemIconWrap}>
                    <Icon size={20} color={scheme.onSecondaryContainer} />
                  </View>

                  <Pressable
                    onPress={() => onSelectPlace?.(item)}
                    style={({ pressed }) => [styles.itemTextWrap, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.itemName} numberOfLines={1} ellipsizeMode="tail">
                      {item.name}
                    </Text>
                    <Text style={styles.itemAddress} numberOfLines={1} ellipsizeMode="tail">
                      {item.address}
                    </Text>
                  </Pressable>

                  <View style={styles.itemActions}>
                    <Pressable
                      onPress={() => onEditPlace(item)}
                      hitSlop={10}
                      style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Pencil size={17} color={scheme.onSurfaceVariant} />
                    </Pressable>

                    <Pressable
                      onPress={() => setDeletingId(item.id)}
                      hitSlop={10}
                      style={({ pressed }) => [styles.actionBtn, styles.deleteBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Trash2 size={17} color={scheme.error} />
                    </Pressable>
                  </View>
                </View>
              );
            }}
          />
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: scheme.surfaceContainer,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    ...elev.level3,
  },
  handle: {
    backgroundColor: scheme.outlineVariant,
    width: 44,
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  headerLeft: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    ...type.titleLarge,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  countBadge: {
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: shape.full,
  },
  countText: {
    ...type.labelSmall,
    color: scheme.onSecondaryContainer,
    fontWeight: '700',
  },
  subtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerAddBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 10,
    paddingBottom: 32,
  },
  placeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    padding: 12,
    gap: 12,
  },
  itemIconWrap: {
    width: 42,
    height: 42,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    justifyContent: 'center',
    paddingRight: 6,
  },
  itemName: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  itemAddress: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  actionBtn: {
    width: 38,
    height: 38,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtn: {
    backgroundColor: scheme.errorContainer,
  },
  // Inline confirmation
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.error,
    borderRadius: shape.large,
    padding: 12,
    gap: 10,
  },
  confirmLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  confirmText: {
    ...type.bodyMedium,
    color: scheme.error,
    fontWeight: '600',
    flex: 1,
  },
  confirmActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  cancelInlineBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  cancelInlineText: {
    ...type.labelSmall,
    color: scheme.onSurface,
  },
  deleteInlineBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.error,
  },
  deleteInlineText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onError,
  },
  // Empty state
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyIconWrap: {
    width: 60,
    height: 60,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontWeight: '600',
  },
  emptySubtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.primary,
    height: 52,
    borderRadius: shape.full,
    paddingHorizontal: 28,
    marginTop: 8,
    ...elev.level2,
  },
  addBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
});
