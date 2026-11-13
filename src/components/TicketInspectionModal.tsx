import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { AlertCircle, ExternalLink, Layers, Trash2, X } from './icons';
import { useStrings } from '../i18n';
import { elev, scheme, shape } from '../theme/tokens';
import type { AttachedRailTicket } from '../services/ticketStorage';
import { openTicketPdf } from '../services/ticketStorage';
import type { Connection } from '../types/models';
import { getTrainLegSummary, stripAgencyPrefix } from '../services/ticketing';
import { M3Dialog } from './M3Dialog';

export interface TicketInspectionModalProps {
  visible: boolean;
  ticket: AttachedRailTicket;
  connection?: Connection;
  onClose: () => void;
  /** Potwierdzone usunięcie biletu z pamięci aplikacji. */
  onDelete?: () => void;
}

export function TicketInspectionModal({
  visible,
  ticket,
  connection,
  onClose,
  onDelete,
}: TicketInspectionModalProps) {
  const s = useStrings();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Stare bilety (sprzed poprawki PNG) mają kody .bmp, których Fresco nie
  // dekoduje: po błędzie ładowania pokazujemy fallback z przyciskiem PDF.
  // Flaga per indeks: błąd jednego odcinka nie chowa pozostałych.
  const [failedIndexes, setFailedIndexes] = useState<Record<number, true>>({});

  useEffect(() => {
    setFailedIndexes({});
  }, [ticket.id, visible]);

  // Lista kodów kreskowych (wsparcie biletów z przesiadką)
  const barcodes = ticket.barcodeUris && ticket.barcodeUris.length > 0
    ? ticket.barcodeUris
    : ticket.barcodeUri
      ? [ticket.barcodeUri]
      : [];

  const [activeBarcodeIndex, setActiveBarcodeIndex] = useState(0);

  useEffect(() => {
    setActiveBarcodeIndex(0);
  }, [ticket.id, visible]);

  const meta = ticket.metadata;
  const trainSummary = connection ? getTrainLegSummary(connection) : null;
  const rawTrain = meta.trainNumber || trainSummary?.trainNumber;
  const trainNumber = rawTrain
    ? stripAgencyPrefix(rawTrain, trainSummary?.agency)
    : undefined;

  const seatParts: string[] = [];
  if (meta.wagon) seatParts.push(s.railTickets.wagonShort(meta.wagon));
  if (meta.seat) seatParts.push(s.railTickets.seatShort(meta.seat));
  const seatInfo = seatParts.join(', ');

  const title = [trainNumber, seatInfo].filter(Boolean).join(' · ');

  // Karta kodu Aztec na środku z hojnym marginesem Quiet Zone i corner radiusem
  const barcodeCardSize = Math.min(screenWidth - 48, screenHeight - 260, 360);
  const barcodeInnerSize = Math.max(120, barcodeCardSize - 48);

  const handleOpenOriginal = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await openTicketPdf(ticket);
  };

  const handleClose = () => {
    void Haptics.selectionAsync().catch(() => {});
    onClose();
  };

  const handleNextBarcode = () => {
    if (barcodes.length <= 1) return;
    void Haptics.selectionAsync().catch(() => {});
    setActiveBarcodeIndex((prev) => (prev + 1) % barcodes.length);
  };

  const handleDeletePress = () => {
    void Haptics.selectionAsync().catch(() => {});
    setConfirmDelete(true);
  };

  const handleDeleteConfirm = () => {
    setConfirmDelete(false);
    onDelete?.();
  };

  const currentBarcodeUri = barcodes[activeBarcodeIndex] || null;
  const currentFailed = Boolean(failedIndexes[activeBarcodeIndex]);

  return (
    <>
      <Modal
        visible={visible}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={handleClose}
      >
        <StatusBar style="light" />
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={s.common.close}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            >
              <X size={20} color={scheme.onSurface} />
            </Pressable>

            {title ? (
              <Text style={styles.headerTitle} numberOfLines={1}>
                {title}
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}

            <View style={styles.headerActions}>
              <Pressable
                onPress={handleOpenOriginal}
                accessibilityRole="button"
                accessibilityLabel={s.railTickets.showTicket}
                style={({ pressed }) => [styles.pdfBtn, pressed && styles.pressed]}
              >
                <Text style={styles.pdfBtnText}>PDF</Text>
                <ExternalLink size={14} color={scheme.onSurfaceVariant} />
              </Pressable>

              {onDelete && (
                <Pressable
                  onPress={handleDeletePress}
                  accessibilityRole="button"
                  accessibilityLabel={s.railTickets.deleteTicket}
                  style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
                >
                  <Trash2 size={18} color={scheme.onSurfaceVariant} />
                </Pressable>
              )}
            </View>
          </View>

          {barcodes.length > 1 && (
            <View style={styles.pagerContainer}>
              <Pressable
                onPress={handleNextBarcode}
                accessibilityRole="button"
                accessibilityLabel={s.railTickets.inspectionSegmentA11y(
                  activeBarcodeIndex + 1,
                  barcodes.length,
                )}
                style={({ pressed }) => [styles.pagerChip, pressed && styles.pressed]}
              >
                <Layers size={14} color={scheme.onPrimaryContainer} />
                <Text style={styles.pagerText}>
                  {s.railTickets.inspectionSegmentLabel(activeBarcodeIndex + 1, barcodes.length)}
                </Text>
              </Pressable>
            </View>
          )}

          <View style={styles.barcodeCenterArea}>
            {currentBarcodeUri && !currentFailed ? (
              <Pressable
                onPress={handleNextBarcode}
                disabled={barcodes.length <= 1}
                style={[
                  styles.barcodeCard,
                  { width: barcodeCardSize, height: barcodeCardSize },
                ]}
              >
                <View style={[styles.barcodeInner, { width: barcodeInnerSize, height: barcodeInnerSize }]}>
                  <Image
                    source={{ uri: currentBarcodeUri }}
                    style={styles.barcodeImage}
                    resizeMode="contain"
                    accessibilityRole="image"
                    accessibilityLabel={s.railTickets.inspectionBarcodeA11y}
                    onError={() =>
                      setFailedIndexes((prev) => ({ ...prev, [activeBarcodeIndex]: true }))
                    }
                  />
                </View>
              </Pressable>
            ) : (
              <View style={styles.fallbackBox}>
                <Text style={styles.fallbackText}>{s.railTickets.inspectionNoBarcode}</Text>
                <Pressable
                  onPress={handleOpenOriginal}
                  style={styles.fallbackBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.fallbackBtnText}>{s.railTickets.showTicket}</Text>
                </Pressable>
              </View>
            )}
          </View>

          <View style={styles.footer}>
            {meta.passenger || meta.tariff ? (
              <View style={styles.passengerChip}>
                <Text style={styles.footerText} numberOfLines={1}>
                  {[meta.passenger, meta.tariff].filter(Boolean).join(' · ')}
                </Text>
              </View>
            ) : null}
          </View>
        </SafeAreaView>
      </Modal>

      {/* Dialog poza Modalem inspekcji: na Androidzie nested Modal bywa niewidoczny. */}
      <M3Dialog
        visible={confirmDelete}
        icon={<AlertCircle size={30} color={scheme.onErrorContainer} />}
        iconContainerColor={scheme.errorContainer}
        title={s.railTickets.deleteTicketTitle}
        message={s.railTickets.deleteTicketBody}
        actions={[
          { label: s.common.cancel, onPress: () => {}, tonal: true },
          { label: s.railTickets.deleteTicket, onPress: handleDeleteConfirm, destructive: true },
        ]}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: scheme.outlineVariant,
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onSurface,
    textAlign: 'center',
    marginHorizontal: 12,
    letterSpacing: -0.2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  pdfBtnText: {
    fontSize: 13,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onSurface,
  },
  pagerContainer: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  pagerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  pagerText: {
    fontSize: 13,
    fontFamily: 'Manrope_600SemiBold',
    color: scheme.onPrimaryContainer,
  },
  barcodeCenterArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  barcodeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: shape.extraLarge,
    alignItems: 'center',
    justifyContent: 'center',
    ...elev.level2,
  },
  barcodeInner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcodeImage: {
    width: '100%',
    height: '100%',
  },
  fallbackBox: {
    alignItems: 'center',
    gap: 16,
    padding: 24,
  },
  fallbackText: {
    fontSize: 15,
    fontFamily: 'Manrope_500Medium',
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
  fallbackBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  fallbackBtnText: {
    fontSize: 14,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onPrimaryContainer,
  },
  footer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    alignItems: 'center',
  },
  passengerChip: {
    maxWidth: '100%',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  footerText: {
    fontSize: 13,
    fontFamily: 'Manrope_500Medium',
    color: scheme.onSurfaceVariant,
  },
  pressed: {
    opacity: 0.7,
  },
});
