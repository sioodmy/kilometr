// Modal podgladu i udostepniania prywatnej grafiki podsumowania podrozy.

import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStrings } from '../i18n';
import type { WrappedSafeSummary } from '../services/userStatsModel';
import {
  shareWrappedGraphic,
  type WrappedExportStrings,
} from '../services/wrappedExport';
import { useEscapeKey, useWebLayout } from '../theme/layout';
import { scheme, shape, type } from '../theme/tokens';
import { Check, Download, ImageUp, X } from './icons';
import { SpringPressable } from './SpringPressable';
import { WrappedShareCard } from './WrappedShareCard';

export function WrappedShareSheet({
  visible,
  summary,
  onClose,
}: {
  visible: boolean;
  summary: WrappedSafeSummary;
  onClose: () => void;
}) {
  const s = useStrings();
  const y = s.yourData;
  const insets = useSafeAreaInsets();
  const webLayout = useWebLayout();
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEscapeKey(visible, onClose);

  useEffect(() => {
    if (!savedNotice) return;
    const t = setTimeout(() => setSavedNotice(false), 2600);
    return () => clearTimeout(t);
  }, [savedNotice]);

  const exportLabels: WrappedExportStrings = {
    title: y.shareSheetTitle,
    subtitle: y.shareSheetSubtitle,
    distanceLabel: y.distanceLabel,
    tripsLabel: y.tripsLabel,
    timeLabel: y.timeLabel,
    railLabel: y.railTitle,
    walkLabel: y.walkLabel,
    stopsLabel: y.stopsLabel,
    citiesLabel: y.citiesLabel,
    co2Label: y.co2Label,
    modesTitle: y.railSectionTitle,
    archetypeLabel: y.archetypes[summary.archetype],
    footerNote: y.wrappedFooter,
    formatKm: y.formatKm,
    formatDuration: y.formatDuration,
    formatMode: (mode) => y.modes[mode],
    formatCo2: y.formatCo2,
  };

  const handleAction = async (saveOnly: boolean) => {
    if (busy) return;
    setBusy(saveOnly ? 'save' : 'share');
    setError(null);
    setSavedNotice(false);
    try {
      await shareWrappedGraphic({
        cardRef,
        summary,
        labels: exportLabels,
        saveOnly,
      });
      if (saveOnly || Platform.OS === 'web') {
        setSavedNotice(true);
      }
    } catch {
      setError(y.shareError);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, webLayout.isMedium && styles.backdropCentered]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={s.share.close}
        />
        <View
          style={[
            styles.sheet,
            webLayout.isMedium ? styles.sheetDesktop : styles.sheetMobile,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} accessibilityRole="header">
                {y.shareSheetTitle}
              </Text>
              <Text style={styles.subtitle}>{y.shareSheetSubtitle}</Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={s.share.close}
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
            >
              <X size={20} color={scheme.onSurface} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Karta przechwytywana do PNG */}
            <View ref={cardRef} collapsable={false} style={styles.cardWrap}>
              <WrappedShareCard summary={summary} />
            </View>

            {error ? (
              <Text style={styles.errorText} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}

            {savedNotice ? (
              <View style={styles.savedRow}>
                <Check size={16} color={scheme.success} />
                <Text style={styles.savedText}>{y.shareSaved}</Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <SpringPressable
                onPress={() => void handleAction(false)}
                disabled={busy !== null}
                haptic="light"
                accessibilityRole="button"
                accessibilityState={{ busy: busy === 'share', disabled: busy !== null }}
                style={[styles.primaryBtn, busy !== null && styles.disabled]}
              >
                {busy === 'share' ? (
                  <ActivityIndicator color={scheme.onPrimary} />
                ) : (
                  <ImageUp size={20} color={scheme.onPrimary} />
                )}
                <Text style={styles.primaryBtnText}>
                  {busy === 'share' ? y.sharePreparing : y.shareAction}
                </Text>
              </SpringPressable>

              <SpringPressable
                onPress={() => void handleAction(true)}
                disabled={busy !== null}
                haptic="selection"
                accessibilityRole="button"
                accessibilityState={{ busy: busy === 'save', disabled: busy !== null }}
                style={[styles.secondaryBtn, busy !== null && styles.disabled]}
              >
                {busy === 'save' ? (
                  <ActivityIndicator color={scheme.onSecondaryContainer} />
                ) : (
                  <Download size={19} color={scheme.onSecondaryContainer} />
                )}
                <Text style={styles.secondaryBtnText}>{y.shareDownload}</Text>
              </SpringPressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  backdropCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: scheme.surfaceContainerLow,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  sheetMobile: {
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    width: '100%',
  },
  sheetDesktop: {
    borderRadius: shape.extraLarge,
    width: '100%',
    maxWidth: 460,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  headerText: {
    flex: 1,
    gap: 3,
  },
  title: {
    ...type.titleLarge,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  subtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
  },
  pressed: {
    opacity: 0.72,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 14,
  },
  cardWrap: {
    alignItems: 'center',
  },
  errorText: {
    ...type.bodySmall,
    color: scheme.error,
    textAlign: 'center',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  savedText: {
    ...type.labelMedium,
    color: scheme.success,
  },
  actions: {
    gap: 10,
    paddingTop: 2,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: scheme.primary,
    borderRadius: shape.full,
    minHeight: 52,
    paddingHorizontal: 20,
  },
  primaryBtnText: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: scheme.secondaryContainer,
    borderRadius: shape.full,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  secondaryBtnText: {
    ...type.titleSmall,
    color: scheme.onSecondaryContainer,
  },
  disabled: {
    opacity: 0.55,
  },
});
