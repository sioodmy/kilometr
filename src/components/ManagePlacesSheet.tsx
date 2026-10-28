import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Pencil, Plus, Trash2, X } from 'lucide-react-native';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { SavedPlace } from '../types/models';
import { SAVED_PLACE_ICONS } from './SavedPlacesRow';

export function ManagePlacesSheet({
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
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

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
      <BottomSheetFlatList
        data={places}
        keyExtractor={(place: SavedPlace) => place.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        overScrollMode="never"
        ListEmptyComponent={
          <View style={styles.empty}>
            <MapPin size={32} color={scheme.primary} />
            <Text style={styles.emptyTitle}>{s.places.emptyTitle}</Text>
            <Text style={styles.emptyBody}>{s.places.emptyBody}</Text>
          </View>
        }
        renderItem={({ item }: { item: SavedPlace }) => {
          const Icon = SAVED_PLACE_ICONS[item.icon] ?? MapPin;
          return (
            <View style={styles.card}>
              <Pressable
                onPress={() => (onSelectPlace ? onSelectPlace(item) : onEditPlace(item))}
                accessibilityRole="button"
                accessibilityLabel={
                  onSelectPlace ? s.home.searchToA11y(item.name) : s.places.editA11y(item.name)
                }
                style={({ pressed }) => [styles.place, pressed && styles.pressed]}
              >
                <View style={styles.placeIcon}>
                  <Icon size={22} color={scheme.onSecondaryContainer} />
                </View>
                <View style={styles.placeText}>
                  <Text style={styles.name} numberOfLines={fontScale > 1.3 ? undefined : 2}>
                    {item.name}
                  </Text>
                  <Text style={styles.address} numberOfLines={fontScale > 1.3 ? undefined : 2}>
                    {item.address}
                  </Text>
                </View>
              </Pressable>
              {deletingId === item.id ? (
                <View style={styles.confirm}>
                  <Text style={styles.confirmText}>{s.places.removeTitle(item.name)}</Text>
                  <View style={styles.actions}>
                    <Pressable
                      onPress={() => setDeletingId(null)}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.action,
                        styles.cancelBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.actionText}>{s.common.cancel}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setDeletingId(null);
                        onDeletePlace(item.id);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.action,
                        styles.deleteBtn,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.deleteText}>{s.places.removeConfirm}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={[styles.actions, styles.cardActions]}>
                  <Pressable
                    onPress={() => onEditPlace(item)}
                    accessibilityRole="button"
                    accessibilityLabel={s.places.editA11y(item.name)}
                    style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                  >
                    <Pencil size={18} color={scheme.onSurfaceVariant} />
                    <Text style={styles.actionText}>{s.places.editAction}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDeletingId(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={s.places.removeA11y(item.name)}
                    style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                  >
                    <Trash2 size={18} color={scheme.error} />
                    <Text style={[styles.actionText, styles.errorText]}>
                      {s.places.removeConfirm}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
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
  list: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 16, gap: 12 },
  card: {
    padding: 16,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerHigh,
    gap: 12,
  },
  place: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64 },
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
