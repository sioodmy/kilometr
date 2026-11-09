import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { elev, scheme, shape } from '../theme/tokens';
import { useStrings } from '../i18n';

export interface M3DialogAction {
  label: string;
  onPress: () => void;
  /** Przycisk tekstowy zamiast wypełnionego. */
  tonal?: boolean;
  destructive?: boolean;
}

interface M3DialogProps {
  visible: boolean;
  icon: ReactNode;
  /** Kolor tonalnego kontenera pod ikoną (np. scheme.errorContainer). */
  iconContainerColor: string;
  title: string;
  message?: string;
  actions: M3DialogAction[];
  onClose: () => void;
}

/**
 * Dialog M3 Expressive: ikona w tonalnym kontenerze, headline, tekst
 * pomocniczy i akcje po prawej. Używany m.in. do odrzucenia biletu
 * kolejowego i potwierdzenia usunięcia.
 */
export function M3Dialog({
  visible,
  icon,
  iconContainerColor,
  title,
  message,
  actions,
  onClose,
}: M3DialogProps) {
  const s = useStrings();
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={s.common.close}>
        <View style={styles.center}>
          <Pressable
            style={styles.card}
            onPress={(e) => e.stopPropagation()}
            onStartShouldSetResponder={() => true}
            accessibilityRole="alert"
            accessibilityLabel={title}
          >
            <View style={[styles.iconBox, { backgroundColor: iconContainerColor }]}>{icon}</View>

            <Text style={styles.title}>{title}</Text>
            {message ? (
              <Text style={styles.message}>{message}</Text>
            ) : null}

            <View style={styles.actions}>
              {actions.map((action, index) => (
                <Pressable
                  key={`${action.label}-${index}`}
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => {});
                    onClose();
                    action.onPress();
                  }}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    !action.tonal && styles.actionFilled,
                    !action.tonal && action.destructive && styles.actionDestructive,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <Text
                    style={[
                      styles.actionLabel,
                      !action.tonal && styles.actionLabelFilled,
                      !action.tonal && action.destructive && styles.actionLabelDestructive,
                    ]}
                  >
                    {action.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: scheme.scrim,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    padding: 24,
    ...elev.level3,
  },
  iconBox: {
    alignSelf: 'flex-start',
    width: 60,
    height: 60,
    borderRadius: shape.large,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onSurface,
    letterSpacing: -0.2,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Manrope_500Medium',
    color: scheme.onSurfaceVariant,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 24,
  },
  actionBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: shape.full,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionFilled: {
    backgroundColor: scheme.primary,
  },
  actionDestructive: {
    backgroundColor: scheme.error,
  },
  actionLabel: {
    fontSize: 14,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onSurface,
  },
  actionLabelFilled: {
    color: scheme.onPrimary,
  },
  actionLabelDestructive: {
    color: scheme.onError,
  },
  pressed: {
    opacity: 0.75,
  },
});
