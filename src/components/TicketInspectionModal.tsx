import { useState } from 'react';
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
import { ExternalLink, Layers, X } from './icons';
import { useStrings } from '../i18n';
import { elev, scheme, shape } from '../theme/tokens';
import type { AttachedRailTicket } from '../services/ticketStorage';
import { openTicketPdf } from '../services/ticketStorage';
import type { Connection } from '../types/models';
import { getTrainLegSummary } from '../services/ticketing';

export interface TicketInspectionModalProps {
  visible: boolean;
  ticket: AttachedRailTicket;
  connection?: Connection;
  onClose: () => void;
}

export function TicketInspectionModal({
  visible,
  ticket,
  connection,
  onClose,
}: TicketInspectionModalProps) {
  const s = useStrings();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Lista kodów kreskowych (wsparcie biletów z przesiadką)
  const barcodes = ticket.barcodeUris && ticket.barcodeUris.length > 0
    ? ticket.barcodeUris
    : ticket.barcodeUri
      ? [ticket.barcodeUri]
      : [];

  const [activeBarcodeIndex, setActiveBarcodeIndex] = useState(0);

  const meta = ticket.metadata;
  const trainSummary = connection ? getTrainLegSummary(connection) : null;
  const trainNumber = meta.trainNumber || trainSummary?.trainNumber;

  const seatParts: string[] = [];
  if (meta.wagon) seatParts.push(`w. ${meta.wagon}`);
  if (meta.seat) seatParts.push(`m. ${meta.seat}`);
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

  const currentBarcodeUri = barcodes[activeBarcodeIndex] || null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea}>
        {/* Pasek górny spójny z motywem aplikacji */}
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

          <Pressable
            onPress={handleOpenOriginal}
            accessibilityRole="button"
            accessibilityLabel={s.railTickets.showTicket}
            style={({ pressed }) => [styles.pdfBtn, pressed && styles.pressed]}
          >
            <Text style={styles.pdfBtnText}>PDF</Text>
            <ExternalLink size={14} color={scheme.onSurfaceVariant} />
          </Pressable>
        </View>

        {/* Przełącznik odcinków przesiadkowych (gdy w PDF jest > 1 kod Aztec) */}
        {barcodes.length > 1 && (
          <View style={styles.pagerContainer}>
            <Pressable
              onPress={handleNextBarcode}
              accessibilityRole="button"
              accessibilityLabel={`Odcinek ${activeBarcodeIndex + 1} z ${barcodes.length}. Dotknij, aby zmienić.`}
              style={({ pressed }) => [styles.pagerChip, pressed && styles.pressed]}
            >
              <Layers size={14} color={scheme.onPrimaryContainer} />
              <Text style={styles.pagerText}>
                Odcinek {activeBarcodeIndex + 1} z {barcodes.length} · Dotknij, aby zmienić
              </Text>
            </Pressable>
          </View>
        )}

        {/* Kontener centralny: dedykowana biała karta na kod Aztec z dużym paddingiem i zaokrągleniami */}
        <View style={styles.barcodeCenterArea}>
          {currentBarcodeUri ? (
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
                  accessibilityLabel="Kod Aztec do kontroli kolejowej"
                />
              </View>
            </Pressable>
          ) : (
            <View style={styles.fallbackBox}>
              <Text style={styles.fallbackText}>Brak kodu rastrowego w PDF</Text>
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

        {/* Pasażer i ulga na dole w spójnym chipie M3 */}
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
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  pagerText: {
    fontSize: 12,
    fontFamily: 'Manrope_600SemiBold',
    color: scheme.onPrimaryContainer,
  },
  pressed: {
    opacity: 0.7,
  },
  barcodeCenterArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  barcodeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: shape.extraLarge,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    ...elev.level3,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
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
    gap: 14,
    padding: 24,
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  fallbackText: {
    fontSize: 14,
    fontFamily: 'Manrope_500Medium',
    color: scheme.onSurfaceVariant,
  },
  fallbackBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  fallbackBtnText: {
    fontSize: 14,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onPrimary,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
  passengerChip: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  footerText: {
    fontSize: 13,
    fontFamily: 'Manrope_600SemiBold',
    color: scheme.onSurfaceVariant,
    letterSpacing: 0.1,
  },
});
