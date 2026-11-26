import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useSheetBackHandler } from '../hooks/useSheetBackHandler';
import {
  DESKTOP_SHEET_TOP_SPACER_HEIGHT,
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

const HANDLE_HEIGHT = 24;

function SheetHandle() {
  return (
    <View style={styles.handleContainer}>
      <View style={styles.handle} />
    </View>
  );
}

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
  const maxAvailable = webLayout.isMedium
    ? windowHeight - 96
    : windowHeight - insets.top - insets.bottom - 16;
  const sheetHeight = webLayout.isMedium
    ? Math.max(320, Math.min(maxAvailable, 680))
    : Math.max(320, Math.min(maxAvailable, Math.round(windowHeight * 0.9)));
  const handleHeight = webLayout.isMedium ? DESKTOP_SHEET_TOP_SPACER_HEIGHT : HANDLE_HEIGHT;
  const contentHeight = Math.max(240, sheetHeight - handleHeight);
  const sheetProps = getDesktopSheetProps(webLayout, insets.bottom, 560, sheetHeight);
  const sheet = useRef<BottomSheet>(null);
  useEscapeKey(true, () => sheet.current?.close());
  const snapPoints = useMemo(() => [sheetHeight], [sheetHeight]);
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

  const { onSheetChange } = useSheetBackHandler(sheet, onClose);

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
      onChange={onSheetChange}
      onClose={onClose}
      backgroundStyle={[styles.sheet, sheetProps.backgroundExtraStyle]}
      handleComponent={webLayout.isMedium ? DesktopSheetTopSpacer : SheetHandle}
      backdropComponent={renderBackdrop}
    >
      {/* Jawna wysokość ogranicza BottomSheetScrollView i przypina akcje na dole arkusza. */}
      <View style={[styles.container, { height: contentHeight }]} accessibilityViewIsModal>
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
          style={styles.scroll}
          contentContainerStyle={styles.content}
          nestedScrollEnabled
          overScrollMode="never"
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

          <Text style={styles.note}>{s.nativeHint}</Text>
          <Text style={styles.note}>{s.privacy}</Text>
        </BottomSheetScrollView>

        <View style={styles.footer}>
          <View style={styles.footerInner}>
            {(error || !journey || !url) && (
              <Text style={styles.error} accessibilityRole="alert">
                {error || s.error}
              </Text>
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
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  sheet: {
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
  },
  handleContainer: {
    height: HANDLE_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    backgroundColor: scheme.outline,
    width: 36,
    height: 4,
    borderRadius: 2,
  },
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
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 2,
    paddingBottom: 16,
    gap: 12,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: scheme.surfaceContainerLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  footerInner: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    gap: 10,
  },
  urlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingLeft: 14,
    paddingRight: 8,
    paddingVertical: 6,
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
    minHeight: 50,
    paddingHorizontal: 20,
    paddingVertical: 12,
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
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 10,
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
