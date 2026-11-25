import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetScrollView,
  useBottomSheetSpringConfigs,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Copy, Download, ImageUp, Link, Share2, X } from './icons';
import * as Clipboard from 'expo-clipboard';
import { motion } from '../theme/motion';
import {
  DesktopSheetTopSpacer,
  getDesktopSheetProps,
  useEscapeKey,
  useWebLayout,
} from '../theme/layout';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings, getLocaleSync } from '../i18n';
import { getActiveCityIdSync } from '../services/cityStore';
import { buildShareUrl, createSharedConnection, shareMessage } from '../sharing/connection';
import type { Connection } from '../types/models';
import { JourneyShareCard } from './JourneyShareCard';
import { SpringPressable } from './SpringPressable';

export function ShareConnectionSheet({
  connection,
  onClose,
}: {
  connection: Connection;
  onClose: () => void;
}) {
  const { share: s } = useStrings();
  const insets = useSafeAreaInsets();
  const webLayout = useWebLayout();
  const { height: windowHeight } = useWindowDimensions();
  const desktopHeight = Math.min(windowHeight - 96, 680);
  const sheetProps = getDesktopSheetProps(webLayout, insets.bottom, 560, desktopHeight);
  const sheet = useRef<BottomSheet>(null);
  useEscapeKey(true, () => sheet.current?.close());
  const snapPoints = useMemo(
    () => (webLayout.isMedium ? [desktopHeight] : ['90%']),
    [desktopHeight, webLayout.isMedium],
  );
  const animationConfigs = useBottomSheetSpringConfigs(motion.sheet);
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        accessibilityLabel={s.close}
      />
    ),
    [s.close],
  );
  const card = useRef<View>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [journey] = useState(() => {
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
  const available = !!journey && !!url;
  const displayUrl = url.replace(/^https:\/\//, '');

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      sheet.current?.close();
      return true;
    });
    return () => back.remove();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(timer);
  }, [copied]);

  async function run(action: () => Promise<unknown>, saving = false) {
    if (busyRef.current || !available) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(saving ? s.saveError : s.error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function shareWebLink() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: s.title, text: message, url });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }
    await Clipboard.setStringAsync(url);
    setCopied(true);
  }

  async function shareCard() {
    const { captureRef } = await import('react-native-view-shot');
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

  /** Zapisuje kartę jako PNG przez systemowy wybór miejsca (SAF na Androidzie, pliki na iOS). */
  async function downloadCard() {
    if (Platform.OS === 'web') {
      await shareWebLink();
      return;
    }
    const { captureRef } = await import('react-native-view-shot');
    const data = await captureRef(card, { format: 'png', result: 'base64' });
    const FileSystem = await import('expo-file-system/legacy');
    const path = `${FileSystem.cacheDirectory ?? ''}kilometr-karta.png`;
    await FileSystem.writeAsStringAsync(path, data, { encoding: FileSystem.EncodingType.Base64 });
    const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
    await Sharing.shareAsync(path, {
      mimeType: 'image/png',
      dialogTitle: s.download,
      UTI: 'public.png',
    });
  }

  return (
    <BottomSheet
      ref={sheet}
      index={0}
      snapPoints={snapPoints}
      animationConfigs={animationConfigs}
      enableDynamicSizing={false}
      topInset={insets.top}
      bottomInset={sheetProps.bottomInset}
      detached={sheetProps.detached}
      style={sheetProps.sheetStyle}
      enablePanDownToClose={!webLayout.isMedium}
      onClose={onClose}
      backgroundStyle={[styles.sheet, sheetProps.backgroundExtraStyle]}
      handleComponent={webLayout.isMedium ? DesktopSheetTopSpacer : undefined}
      handleIndicatorStyle={styles.handle}
      backdropComponent={renderBackdrop}
    >
      <View style={styles.container} accessibilityViewIsModal>
        <View style={styles.header}>
          <View style={styles.headerTitleCol}>
            <Text style={styles.title} accessibilityRole="header">
              {s.title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {s.subtitle}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            onPress={() => sheet.current?.close()}
            accessibilityRole="button"
            accessibilityLabel={s.close}
          >
            <X size={20} color={scheme.onSurface} />
          </Pressable>
        </View>
        <BottomSheetScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        >
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

          {available && (
            <SpringPressable
              onPress={() =>
                void run(async () => {
                  await Clipboard.setStringAsync(url);
                  setCopied(true);
                })
              }
              disabled={busy}
              haptic="selection"
              accessibilityRole="button"
              accessibilityLabel={copied ? s.copied : s.copy}
              style={styles.urlBar}
            >
              <Link size={16} color={scheme.primary} />
              <Text style={styles.urlText} numberOfLines={1} ellipsizeMode="middle">
                {displayUrl}
              </Text>
              <View style={[styles.urlCopyChip, copied && styles.urlCopyChipDone]}>
                {copied ? (
                  <Check size={14} color={scheme.onPrimaryContainer} />
                ) : (
                  <Copy size={14} color={scheme.onSecondaryContainer} />
                )}
                <Text style={[styles.urlCopyText, copied && styles.urlCopyTextDone]}>
                  {copied ? s.copied : s.copy}
                </Text>
              </View>
            </SpringPressable>
          )}

          {(error || !journey || !url) && (
            <Text style={styles.error} accessibilityRole="alert">
              {error || s.error}
            </Text>
          )}

          <SpringPressable
            onPress={() => void run(Platform.OS === 'web' ? shareWebLink : shareCard)}
            disabled={busy || !available}
            haptic="light"
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy || !available }}
            style={[styles.primary, (busy || !available) && styles.disabled]}
          >
            {busy ? (
              <ActivityIndicator color={scheme.onPrimary} />
            ) : Platform.OS === 'web' ? (
              <Share2 size={20} color={scheme.onPrimary} />
            ) : (
              <ImageUp size={20} color={scheme.onPrimary} />
            )}
            <Text style={styles.primaryText}>
              {busy ? s.preparing : Platform.OS === 'web' ? s.linkOnly : s.imageAndLink}
            </Text>
          </SpringPressable>

          {Platform.OS !== 'web' && (
            <View style={styles.actions}>
              <SpringPressable
                onPress={() => void run(downloadCard, true)}
                disabled={busy || !available}
                haptic="selection"
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || !available }}
                style={[styles.action, (busy || !available) && styles.disabled]}
              >
                <Download size={19} color={scheme.onSecondaryContainer} />
                <Text style={styles.actionText}>{s.download}</Text>
              </SpringPressable>
              <SpringPressable
                onPress={() => void run(() => Share.share({ title: s.title, message }))}
                disabled={busy || !available}
                haptic="selection"
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || !available }}
                style={[styles.action, (busy || !available) && styles.disabled]}
              >
                <Link size={19} color={scheme.onSecondaryContainer} />
                <Text style={styles.actionText}>{s.linkOnly}</Text>
              </SpringPressable>
            </View>
          )}

          <Text style={styles.note}>{s.nativeHint}</Text>
          <Text style={styles.note}>{s.privacy}</Text>
        </BottomSheetScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheet: {
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  handle: { backgroundColor: scheme.outline, width: 36 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingLeft: 20,
    paddingRight: 14,
    paddingBottom: 12,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  subtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  content: {
    paddingHorizontal: 18,
    gap: 14,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  urlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
  },
  urlText: {
    flex: 1,
    minWidth: 0,
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  urlCopyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
  },
  urlCopyChipDone: {
    backgroundColor: scheme.primaryContainer,
  },
  urlCopyText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  urlCopyTextDone: {
    color: scheme.onPrimaryContainer,
  },
  note: { ...type.bodySmall, color: scheme.onSurfaceVariant, lineHeight: 18 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  primaryText: {
    ...type.labelLarge,
    fontWeight: '800',
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
    gap: 8,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
  },
  actionText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
    flexShrink: 1,
  },
  error: { ...type.bodyMedium, color: scheme.error },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
