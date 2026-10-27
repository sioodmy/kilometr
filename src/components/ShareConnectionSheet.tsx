import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Copy, ImageUp, Link, MessageCircle, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { captureRef } from 'react-native-view-shot';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings, getLocaleSync } from '../i18n';
import { getActiveCityIdSync } from '../services/cityStore';
import { buildShareUrl, createSharedConnection, shareMessage } from '../sharing/connection';
import type { Connection } from '../types/models';
import { JourneyShareCard } from './JourneyShareCard';
import { getSharedJourneyData } from '../services/sharedJourneyData';

export function ShareConnectionSheet({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose: () => void;
}) {
  const { share: s } = useStrings();
  const insets = useSafeAreaInsets();
  const sheet = useRef<BottomSheet>(null);
  const card = useRef<View>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geometryLoading, setGeometryLoading] = useState(true);
  const [journey, setJourney] = useState(() => {
    try {
      return createSharedConnection(connection, getActiveCityIdSync());
    } catch {
      return null;
    }
  });
  let url = '';
  try {
    if (journey) url = buildShareUrl(journey, getLocaleSync());
  } catch {
    /* Zbyt duży link pozostawia widoczną kartę i komunikat błędu. */
  }
  const message = journey ? `${shareMessage(journey, s)}\n${url}` : '';
  const available = !!journey && !!url && !geometryLoading;

  useEffect(() => {
    const snapshot = journey;
    if (!snapshot) {
      setGeometryLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      if (active) setGeometryLoading(false);
    }, 12000);
    void getSharedJourneyData(snapshot, controller.signal)
      .then((details) => {
        if (active && !controller.signal.aborted) setJourney(details.journey);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        if (active) setGeometryLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      sheet.current?.close();
      return true;
    });
    return () => back.remove();
  }, []);

  async function run(action: () => Promise<unknown>, sms = false) {
    if (busyRef.current || !available) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(sms ? s.smsError : s.error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function shareCard() {
    const data = await captureRef(card, { format: 'png', result: 'base64' });
    const { default: NativeShare } = await import('react-native-share');
    await NativeShare.open({
      title: s.title,
      message,
      url: `data:image/png;base64,${data}`,
      type: 'image/png',
      filename: 'kilometr',
      useInternalStorage: true,
      failOnCancel: false,
    });
  }

  return (
    <BottomSheet
      ref={sheet}
      index={0}
      snapPoints={['90%']}
      enableDynamicSizing={false}
      topInset={insets.top}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={styles.sheet}
      handleIndicatorStyle={styles.handle}
      backdropComponent={(props) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          accessibilityLabel={s.close}
        />
      )}
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {s.title}
        </Text>
        <Pressable
          style={styles.close}
          onPress={() => sheet.current?.close()}
          accessibilityRole="button"
          accessibilityLabel={s.close}
        >
          <X size={22} color={scheme.onSurface} />
        </Pressable>
      </View>
      <BottomSheetScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      >
        <Text style={styles.subtitle}>{s.subtitle}</Text>
        {journey && (
          <View
            ref={card}
            collapsable={false}
            accessible
            accessibilityRole="image"
            accessibilityLabel={shareMessage(journey, s)}
          >
            <JourneyShareCard journey={journey} />
          </View>
        )}
        <Text style={styles.note}>{s.snapshot}</Text>
        <Text style={styles.note}>{s.nativeHint}</Text>
        {geometryLoading && (
          <Text style={styles.note} accessibilityLiveRegion="polite">
            {s.geometryLoading}
          </Text>
        )}
        {(error || !journey || !url) && (
          <Text style={styles.error} accessibilityRole="alert">
            {error || s.error}
          </Text>
        )}
        <Pressable
          onPress={() =>
            void run(Platform.OS === 'web' ? () => Share.share({ message }) : shareCard)
          }
          disabled={busy || !available}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy || !available }}
          style={({ pressed }) => [
            styles.primary,
            pressed && styles.pressed,
            (busy || !available) && styles.disabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={scheme.onPrimary} />
          ) : (
            <ImageUp size={22} color={scheme.onPrimary} />
          )}
          <Text style={styles.primaryText}>
            {busy ? s.preparing : Platform.OS === 'web' ? s.linkOnly : s.imageAndLink}
          </Text>
        </Pressable>
        <View style={styles.actions}>
          <Pressable
            onPress={() =>
              void run(
                () =>
                  Linking.openURL(
                    `sms:${Platform.OS === 'ios' ? '&' : '?'}body=${encodeURIComponent(message)}`,
                  ),
                true,
              )
            }
            disabled={busy || !available}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || !available }}
            style={({ pressed }) => [
              styles.action,
              pressed && styles.pressed,
              (busy || !available) && styles.disabled,
            ]}
          >
            <MessageCircle size={22} color={scheme.onSecondaryContainer} />
            <Text style={styles.actionText}>{s.sms}</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              void run(async () => {
                await Clipboard.setStringAsync(url);
                setCopied(true);
              })
            }
            disabled={busy || !available}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || !available }}
            style={({ pressed }) => [
              styles.action,
              pressed && styles.pressed,
              (busy || !available) && styles.disabled,
            ]}
          >
            {copied ? (
              <Check size={22} color={scheme.onSecondaryContainer} />
            ) : (
              <Copy size={22} color={scheme.onSecondaryContainer} />
            )}
            <Text style={styles.actionText} accessibilityLiveRegion="polite">
              {copied ? s.copied : s.copy}
            </Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => void run(() => Share.share({ title: s.title, message }))}
          disabled={busy || !available}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || !available }}
          style={({ pressed }) => [
            styles.linkAction,
            pressed && styles.pressed,
            (busy || !available) && styles.disabled,
          ]}
        >
          <Link size={20} color={scheme.primary} />
          <Text style={styles.linkText}>{s.linkOnly}</Text>
        </Pressable>
        <Text style={styles.note}>{s.privacy}</Text>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  handle: { backgroundColor: scheme.outline, width: 36 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 24,
    paddingRight: 12,
    paddingBottom: 8,
  },
  title: { ...type.titleLarge, fontWeight: '600', flex: 1, color: scheme.onSurface },
  close: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.medium,
  },
  content: { paddingHorizontal: 20, gap: 16, width: '100%', maxWidth: 600, alignSelf: 'center' },
  subtitle: { ...type.bodyLarge, color: scheme.onSurfaceVariant, lineHeight: 23 },
  note: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: 60,
    padding: 16,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.primary,
  },
  primaryText: {
    ...type.titleMedium,
    fontWeight: '700',
    color: scheme.onPrimary,
    flexShrink: 1,
    textAlign: 'center',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  action: {
    flexGrow: 1,
    flexBasis: 140,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 64,
    padding: 16,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.large,
  },
  actionText: { ...type.labelLarge, color: scheme.onSecondaryContainer, flexShrink: 1 },
  linkAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 48,
    padding: 12,
    borderRadius: shape.medium,
  },
  linkText: { ...type.labelLarge, color: scheme.primary, flexShrink: 1 },
  error: { ...type.bodyMedium, color: scheme.error },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
