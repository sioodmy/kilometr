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
import { ExternalLink, X } from './icons';
import { useStrings } from '../i18n';
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

  // Kod Aztec powinien zajmować maksymalną przestrzeń ekranu z zachowaniem marginesu Quiet Zone
  const barcodeSize = Math.min(screenWidth - 48, screenHeight - 240, 360);

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
      <StatusBar style="dark" backgroundColor="#FFFFFF" />
      <SafeAreaView style={styles.safeArea}>
        {/* Minimalistyczny pasek górny */}
        <View style={styles.header}>
          <Pressable
            onPress={handleClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={s.common.close}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <X size={22} color="#1A211E" />
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
            <ExternalLink size={14} color="#1A211E" />
          </Pressable>
        </View>

        {/* Wskaźnik przesiadki (jeśli bilet ma więcej niż jeden kod Aztec) */}
        {barcodes.length > 1 && (
          <Pressable
            onPress={handleNextBarcode}
            accessibilityRole="button"
            accessibilityLabel={`Kod ${activeBarcodeIndex + 1} z ${barcodes.length}. Dotknij, aby zmienić odcinek.`}
            style={styles.pagerBar}
          >
            <Text style={styles.pagerText}>
              Odcinek {activeBarcodeIndex + 1} z {barcodes.length} (dotknij, aby zmienić)
            </Text>
          </Pressable>
        )}

        {/* Czysty, gigantyczny kod Aztec na białym tle */}
        <View style={styles.barcodeContainer}>
          {currentBarcodeUri ? (
            <Pressable
              onPress={handleNextBarcode}
              disabled={barcodes.length <= 1}
              style={[styles.barcodeWrapper, { width: barcodeSize, height: barcodeSize }]}
            >
              <Image
                source={{ uri: currentBarcodeUri }}
                style={styles.barcodeImage}
                resizeMode="contain"
                accessibilityRole="image"
                accessibilityLabel="Kod Aztec do kontroli kolejowej"
              />
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

        {/* Dyskretna linia pasażera i ulgi na dole ekranu */}
        <View style={styles.footer}>
          {meta.passenger || meta.tariff ? (
            <Text style={styles.footerText} numberOfLines={1}>
              {[meta.passenger, meta.tariff].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8E0',
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Manrope_700Bold',
    color: '#1A211E',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  pdfBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F2',
  },
  pdfBtnText: {
    fontSize: 13,
    fontFamily: 'Manrope_600SemiBold',
    color: '#1A211E',
  },
  pagerBar: {
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: '#F5FBF7',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CCE8E0',
  },
  pagerText: {
    fontSize: 12,
    fontFamily: 'Manrope_600SemiBold',
    color: '#006A60',
  },
  pressed: {
    opacity: 0.6,
  },
  barcodeContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  barcodeWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  barcodeImage: {
    width: '100%',
    height: '100%',
  },
  fallbackBox: {
    alignItems: 'center',
    gap: 12,
  },
  fallbackText: {
    fontSize: 14,
    fontFamily: 'Manrope_500Medium',
    color: '#6F7975',
  },
  fallbackBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#006A60',
  },
  fallbackBtnText: {
    fontSize: 14,
    fontFamily: 'Manrope_600SemiBold',
    color: '#FFFFFF',
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    fontFamily: 'Manrope_500Medium',
    color: '#8A938F',
    letterSpacing: 0.2,
  },
});
