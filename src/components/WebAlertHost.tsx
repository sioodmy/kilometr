// Host dialogów Alert.alert dla wersji webowej: react-native-web implementuje
// Alert.alert jako pustą funkcję, więc przechwytujemy wywołania i rysujemy
// dialog M3 Expressive spójny z aplikacją natywną.

import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AlertButton,
  type AlertOptions,
} from 'react-native';
import { useStrings } from '../i18n';
import { elev, scheme, shape, type } from '../theme/tokens';

interface QueuedAlert {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  options?: AlertOptions;
}

type EnqueueFn = (item: QueuedAlert) => void;
let activeEnqueue: EnqueueFn | null = null;
let installed = false;

function installWebAlertPatch(): void {
  if (Platform.OS !== 'web' || installed) return;
  installed = true;
  Alert.alert = (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions,
  ) => {
    if (activeEnqueue) {
      activeEnqueue({ title, message, buttons, options });
      return;
    }
    if (typeof window !== 'undefined') {
      const text = message ? `${title}\n\n${message}` : title;
      window.alert(text);
    }
  };
}

/** Montować raz w głównym layoucie aplikacji (no-op poza webem). */
export function WebAlertHost() {
  const s = useStrings();
  const [queue, setQueue] = useState<QueuedAlert[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    installWebAlertPatch();
    activeEnqueue = (item) => setQueue((prev) => [...prev, item]);
    return () => {
      activeEnqueue = null;
    };
  }, []);

  const dismiss = (runCancel?: boolean) => {
    setQueue((prev) => {
      const [head, ...rest] = prev;
      if (runCancel && head) {
        const cancelBtn = head.buttons?.find((b) => b.style === 'cancel');
        cancelBtn?.onPress?.();
        head.options?.onDismiss?.();
      }
      return rest;
    });
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || !current) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && current.options?.cancelable !== false) {
        dismiss(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current]);

  if (Platform.OS !== 'web' || !current) return null;

  const buttons: AlertButton[] =
    current.buttons && current.buttons.length > 0
      ? current.buttons
      : [{ text: s.common.close }];

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (current.options?.cancelable !== false) dismiss(true);
      }}
    >
      <View style={styles.scrim}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (current.options?.cancelable !== false) dismiss(true);
          }}
          accessibilityLabel={s.common.close}
        />
        <View style={styles.center} pointerEvents="box-none">
          <View
            style={styles.card}
            accessibilityRole="alert"
            accessibilityLabel={current.title}
            accessibilityViewIsModal
          >
            {current.title ? <Text style={styles.title}>{current.title}</Text> : null}
            {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
            <View style={styles.actions}>
              {buttons.map((btn, idx) => {
                const isCancel = btn.style === 'cancel';
                const isDestructive = btn.style === 'destructive';
                const isPrimary = !isCancel && !isDestructive && idx === buttons.length - 1;
                return (
                  <Pressable
                    key={`${btn.text ?? idx}-${idx}`}
                    onPress={() => {
                      dismiss(false);
                      btn.onPress?.();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={btn.text ?? s.common.close}
                    style={({ pressed }) => [
                      styles.btn,
                      isPrimary && styles.btnPrimary,
                      isDestructive && styles.btnDestructive,
                      pressed && styles.btnPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        isPrimary && styles.btnTextPrimary,
                        isDestructive && styles.btnTextDestructive,
                      ]}
                    >
                      {btn.text ?? s.common.close}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.extraLarge,
    padding: 24,
    gap: 14,
    ...elev.level3,
  },
  title: {
    ...type.titleLarge,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  message: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 21,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 6,
  },
  btn: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 16,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: scheme.primary,
  },
  btnDestructive: {
    backgroundColor: scheme.errorContainer,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnText: {
    ...type.labelLarge,
    fontWeight: '600',
    color: scheme.primary,
  },
  btnTextPrimary: {
    color: scheme.onPrimary,
  },
  btnTextDestructive: {
    color: scheme.onErrorContainer,
  },
});
