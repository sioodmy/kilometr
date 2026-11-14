import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  ChevronRight,
  ExternalLink,
  FileUp,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  TrainFront,
  X,
} from './icons';
import { useStrings } from '../i18n';
import { elev, scheme, shape } from '../theme/tokens';
import type { Connection } from '../types/models';
import type { TransferProtectionState } from '../services/notifications/transferTypes';
import { checkTicketCompensation } from '../services/notifications';
import { transferNeedsAttention } from './TransferProtectionCard';
import {
  getTrainLegSummary,
  hasTrainLegs,
  openKoleoRoute,
  stripAgencyPrefix,
} from '../services/ticketing';
import { RoutingService } from '../services';
import {
  deleteTicketForConnection,
  getTicketForConnection,
  importTicketPdf,
  openTicketPdf,
  type AttachedRailTicket,
  type TicketImportRejected,
} from '../services/ticketStorage';
import { TicketInspectionModal } from './TicketInspectionModal';
import { M3Dialog } from './M3Dialog';
import { AlertCircle, FileDoc } from './icons';

/** YYYY-MM-DD -> DD.MM.YYYY do wyświetlania dat w komunikatach. */
function formatDateForDisplay(date?: string): string {
  if (!date) return '';
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function DeckSegmentButton({
  children,
  onPress,
  onLongPress,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  disabled,
}: {
  children: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  style?: unknown;
  accessibilityLabel: string;
  accessibilityRole?: 'button' | 'link';
  disabled?: boolean;
}) {
  const press = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.02 }],
    opacity: 1 - press.value * 0.12,
  }));

  const setPress = (val: number) => {
    press.value = withSpring(val, {
      damping: 24,
      stiffness: 420,
      reduceMotion: ReduceMotion.System,
    });
  };

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => setPress(1)}
      onPressOut={() => setPress(0)}
      style={[style, animStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}

export type RouteTravelDeckProps = {
  connection: Connection;
  hasTransfers: boolean;
  transferState?: TransferProtectionState;
  transferActive: boolean;
  trackingBusy?: boolean;
  onTransferPress: () => void;
  /** Z powiadomienia „Bilet": po wczytaniu otwórz kontrolę / PDF. */
  autoInspectTicket?: boolean;
};

export function RouteTravelDeck({
  connection,
  hasTransfers,
  transferState,
  transferActive,
  trackingBusy,
  onTransferPress,
  autoInspectTicket = false,
}: RouteTravelDeckProps) {
  const s = useStrings();
  const [ticket, setTicket] = useState<AttachedRailTicket | null>(null);
  const [ticketSheetOpen, setTicketSheetOpen] = useState(false);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rejection, setRejection] = useState<TicketImportRejected | null>(null);
  // Import trwa, a systemowy picker wraca do apki jako 'active'. Bez tej flagi
  // przeładowanie z dysku mogłoby nadpisać świeżo dodany bilet stanem sprzed importu.
  const importInFlight = useRef(false);
  const autoInspectDone = useRef(false);

  const isTrainTrip = hasTrainLegs(connection);
  const trainSummary = getTrainLegSummary(connection);
  const showTicketSegment = isTrainTrip && trainSummary !== null;
  const showTransferSegment = hasTransfers;

  useEffect(() => {
    let active = true;
    // Nowe połączenie: nie pokazuj biletu z poprzedniej karty.
    setTicket(null);
    autoInspectDone.current = false;
    const loadTicket = () => {
      void getTicketForConnection(connection.id, connection).then((t) => {
        if (!active) return;
        // Podczas importu picker wraca do apki: nie nadpisuj świeżego biletu
        // pustym odczytem sprzed zapisu.
        setTicket((prev) => {
          if (importInFlight.current && t === null && prev !== null) return prev;
          return t;
        });
      });
    };
    loadTicket();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !importInFlight.current) {
        loadTicket();
      }
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, [connection.id, connection.serviceDate]);

  // Deep link / akcja „Bilet" z powiadomienia: otwórz kontrolę raz po wczytaniu.
  useEffect(() => {
    if (!autoInspectTicket || !ticket || autoInspectDone.current) return;
    autoInspectDone.current = true;
    void Haptics.selectionAsync().catch(() => {});
    const hasBarcode = Boolean(
      ticket.barcodeUri || (ticket.barcodeUris && ticket.barcodeUris.length > 0),
    );
    if (hasBarcode) setInspectionOpen(true);
    else void openTicketPdf(ticket);
  }, [autoInspectTicket, ticket]);

  if (!showTicketSegment && !showTransferSegment) {
    return null;
  }

  // Stan ostrzeżenia ochrony przesiadek (zagrożenie przesiadki / opóźnienie)
  const isWarning = transferActive && transferNeedsAttention(transferState);
  const isSafe = transferActive && transferState?.status === 'safe';
  const slackMin = Math.max(0, Math.floor((transferState?.slackSec ?? 0) / 60));

  // --- Handlery biletu ---
  const ticketHasBarcode = (t: AttachedRailTicket) =>
    Boolean(t.barcodeUri || (t.barcodeUris && t.barcodeUris.length > 0));

  const handleTicketPress = async () => {
    if (ticket) {
      void Haptics.selectionAsync().catch(() => {});
      if (ticketHasBarcode(ticket)) {
        setInspectionOpen(true);
      } else {
        await openTicketPdf(ticket);
      }
    } else {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setTicketSheetOpen(true);
    }
  };

  const handleTicketLongPress = () => {
    if (!ticket) return;
    void Haptics.selectionAsync().catch(() => {});
    const trainNum = ticket.metadata.trainNumber
      ? stripAgencyPrefix(ticket.metadata.trainNumber, trainSummary?.agency)
      : null;
    Alert.alert(
      s.railTickets.attachedTitle,
      trainNum ? s.railTickets.trainLabel(trainNum) : ticket.fileName,
      [
        ...(ticketHasBarcode(ticket)
          ? [
              {
                text: s.railTickets.inspectCode,
                onPress: () => setInspectionOpen(true),
              },
            ]
          : []),
        {
          text: s.railTickets.showTicket,
          onPress: async () => {
            await openTicketPdf(ticket);
          },
        },
        {
          text: s.railTickets.removeTicket,
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              s.railTickets.removeConfirmTitle,
              s.railTickets.removeConfirmBody,
              [
                { text: s.common.cancel, style: 'cancel' },
                {
                  text: s.common.yesRemove,
                  style: 'destructive',
                  onPress: async () => {
                    await deleteTicketForConnection(connection.id);
                    setTicket(null);
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  },
                },
              ],
            );
          },
        },
        { text: s.common.cancel, style: 'cancel' },
      ],
    );
  };

  const handleBuyKoleo = async () => {
    setTicketSheetOpen(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const success = await openKoleoRoute(connection);
    if (!success) {
      Alert.alert(s.railTickets.koleoOpenFailTitle, s.railTickets.koleoOpenFailBody);
    }
  };

  const handleAttachPdf = async () => {
    if (importInFlight.current) return;
    importInFlight.current = true;
    try {
      setImporting(true);
      void Haptics.selectionAsync().catch(() => {});
      const result = await importTicketPdf(connection.id, connection);
      if (result.status === 'attached') {
        const imported = result.ticket;
        setTicket(imported);
        setTicketSheetOpen(false);
        // Połączenie z biletem trafia do „Twoich tras”: bilet jest powodem,
        // dla którego user wróci do tej trasy (kontrola, historia przejazdu).
        try {
          await RoutingService.saveRoute(connection);
        } catch (err) {
          console.warn('[RouteTravelDeck] saveRoute for ticket failed:', err);
        }
        void checkTicketCompensation();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        // Jeśli bilet ma wyekstrahowany kod, natychmiast pokaż podgląd do wglądu
        if (ticketHasBarcode(imported)) {
          setInspectionOpen(true);
        } else {
          Alert.alert(s.railTickets.attachedTitle, s.railTickets.importSuccess);
        }
      } else if (result.status === 'rejected') {
        // Sheet pod M3Dialog chowałby błąd: zamykamy najpierw.
        setTicketSheetOpen(false);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        setRejection(result);
      }
    } catch (err) {
      console.warn('[RouteTravelDeck] attach error:', err);
      setTicketSheetOpen(false);
      Alert.alert(s.common.storageFailTitle, s.railTickets.importError);
    } finally {
      importInFlight.current = false;
      setImporting(false);
    }
  };

  // Treść dialogu odrzucenia zależna od powodu (M3 Expressive)
  const rejectionContent = (() => {
    if (!rejection) return null;
    switch (rejection.reason) {
      case 'tooLarge':
        return {
          title: s.railTickets.rejectTooLargeTitle,
          message: s.railTickets.rejectTooLargeBody,
        };
      case 'notTicket':
        return {
          title: s.railTickets.rejectNotTicketTitle,
          message: s.railTickets.rejectNotTicketBody,
        };
      case 'wrongTrain':
        return {
          title: s.railTickets.rejectWrongTrainTitle,
          message: s.railTickets.rejectWrongTrainBody(
            rejection.ticketTrainNumber ?? '',
            rejection.connectionTrainNumber ?? '',
          ),
        };
      case 'wrongDate':
        return {
          title: s.railTickets.rejectWrongDateTitle,
          message: s.railTickets.rejectWrongDateBody(
            formatDateForDisplay(rejection.ticketDate),
            formatDateForDisplay(rejection.connectionDate),
          ),
        };
      default:
        return null;
    }
  })();

  // --- Dane tekstowe segmentu biletu ---
  const meta = ticket?.metadata;
  const rawTrainNum = meta?.trainNumber || trainSummary?.trainNumber;
  const resolvedTrainNum = rawTrainNum
    ? stripAgencyPrefix(rawTrainNum, trainSummary?.agency)
    : undefined;
  const trainLabel = resolvedTrainNum
    ? trainSummary?.agency
      ? s.railTickets.agencyTrain(trainSummary.agency, resolvedTrainNum)
      : resolvedTrainNum
    : s.railTickets.ticketFallback;

  const ticketTitle = ticket ? trainLabel : s.railTickets.attachedTitle;

  const seatParts: string[] = [];
  if (meta?.wagon) seatParts.push(s.railTickets.wagonShort(meta.wagon));
  if (meta?.seat) seatParts.push(s.railTickets.seatShort(meta.seat));
  const seatLabel = seatParts.length > 0 ? seatParts.join(' · ') : null;

  const ticketSubtitle = ticket
    ? (seatLabel ?? (meta?.passenger ? meta.passenger : s.railTickets.showShort))
    : s.railTickets.buyOrAdd;

  // --- Dane tekstowe segmentu ochrony przesiadek ---
  const transferTitle = s.travelDeck.protection;
  const transferSubtitle = !transferActive
    ? s.travelDeck.protectionEnable
    : isWarning
      ? s.travelDeck.protectionAtRisk
      : isSafe
        ? s.travelDeck.protectionSlack(slackMin)
        : s.travelDeck.protectionWatching;

  return (
    <Animated.View
      layout={LinearTransition.springify().damping(28).stiffness(320)}
      style={styles.container}
    >
      <View style={styles.deckPill}>
        {/* SEGMENT 1: BILET KOLEJOWY (tylko trasy z pociągiem) */}
        {showTicketSegment && (
          <DeckSegmentButton
            onPress={handleTicketPress}
            onLongPress={handleTicketLongPress}
            accessibilityLabel={`${ticketTitle}, ${ticketSubtitle}`}
            style={[styles.segment, styles.ticketSegment]}
          >
            <View
              style={[
                styles.iconBadge,
                ticket ? styles.ticketBadgeAttached : styles.ticketBadgeEmpty,
              ]}
            >
              {ticket ? (
                ticketHasBarcode(ticket) ? (
                  <ScanLine size={16} color={scheme.onPrimaryContainer} />
                ) : (
                  <TrainFront size={16} color={scheme.onPrimaryContainer} />
                )
              ) : (
                <TrainFront size={16} color={scheme.onSurfaceVariant} />
              )}
            </View>

            <View style={styles.segmentTextCol}>
              <Text
                style={[
                  styles.segmentTitle,
                  ticket && styles.segmentTitleActive,
                ]}
                numberOfLines={1}
              >
                {ticketTitle}
              </Text>
              <Text
                style={[
                  styles.segmentSubtitle,
                  ticket && styles.segmentSubtitleTicketAttached,
                ]}
                numberOfLines={1}
              >
                {ticketSubtitle}
              </Text>
            </View>
          </DeckSegmentButton>
        )}

        {/* DELIKATNY SEPARATOR (gdy oba segmenty są widoczne) */}
        {showTicketSegment && showTransferSegment && (
          <View style={styles.divider} />
        )}

        {/* SEGMENT 2: OCHRONA PRZESIADEK (trasy z co najmniej 1 przesiadką) */}
        {showTransferSegment && (
          <DeckSegmentButton
            onPress={onTransferPress}
            disabled={trackingBusy}
            accessibilityLabel={`${transferTitle}, ${transferSubtitle}`}
            style={[
              styles.segment,
              styles.transferSegment,
              isWarning && styles.transferSegmentWarning,
            ]}
          >
            <View
              style={[
                styles.iconBadge,
                !transferActive && styles.transferBadgeInactive,
                transferActive && isSafe && styles.transferBadgeSafe,
                transferActive && isWarning && styles.transferBadgeWarning,
                transferActive && !isSafe && !isWarning && styles.transferBadgeActive,
              ]}
            >
              {trackingBusy ? (
                <ActivityIndicator size="small" color={scheme.primary} />
              ) : !transferActive ? (
                <ShieldOff size={16} color={scheme.onSurfaceVariant} />
              ) : isWarning ? (
                <ShieldAlert size={16} color={scheme.onWarningContainer} />
              ) : (
                <ShieldCheck size={16} color={scheme.onPrimaryContainer} />
              )}
            </View>

            <View style={styles.segmentTextCol}>
              <Text
                style={[
                  styles.segmentTitle,
                  transferActive && styles.segmentTitleActive,
                  isWarning && styles.segmentTitleWarning,
                ]}
                numberOfLines={1}
              >
                {isWarning ? s.travelDeck.transferAlert : transferTitle}
              </Text>
              <Text
                style={[
                  styles.segmentSubtitle,
                  transferActive && styles.segmentSubtitleActive,
                  isWarning && styles.segmentSubtitleWarning,
                ]}
                numberOfLines={1}
              >
                {transferSubtitle}
              </Text>
            </View>
          </DeckSegmentButton>
        )}
      </View>

      {/* MODAL PEŁNOEKRANOWEGO KONTROLERA BILETU (AZTEC FOCUS) */}
      {ticket && (
        <TicketInspectionModal
          visible={inspectionOpen}
          ticket={ticket}
          connection={connection}
          onClose={() => setInspectionOpen(false)}
          onDelete={async () => {
            await deleteTicketForConnection(connection.id);
            setInspectionOpen(false);
            setTicket(null);
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }}
        />
      )}

      {/* ODRZUCENIE BILETU: dialog M3 z wyjaśnieniem (zły pociąg, zła data, to nie bilet) */}
      {rejection && rejectionContent && (
        <M3Dialog
          visible
          icon={
            rejection.reason === 'notTicket' ? (
              <FileDoc size={30} color={scheme.onSecondaryContainer} />
            ) : (
              <AlertCircle size={30} color={scheme.onErrorContainer} />
            )
          }
          iconContainerColor={
            rejection.reason === 'notTicket'
              ? scheme.secondaryContainer
              : scheme.errorContainer
          }
          title={rejectionContent.title}
          message={rejectionContent.message}
          actions={[{ label: s.common.close, onPress: () => {} }]}
          onClose={() => setRejection(null)}
        />
      )}

      {/* DIALOG SZYBKIEJ AKCJI BILETU (KOLEO / IMPORT PDF) */}
      <Modal
        visible={ticketSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTicketSheetOpen(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setTicketSheetOpen(false)}
        >
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalHeading}>{s.railTickets.deckSheetTitle}</Text>
                {trainSummary && (
                  <Text style={styles.modalSubheading} numberOfLines={1}>
                    {trainSummary.fromStation} → {trainSummary.toStation}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => setTicketSheetOpen(false)}
                hitSlop={8}
                style={styles.modalCloseBtn}
                accessibilityRole="button"
                accessibilityLabel={s.common.close}
              >
                <X size={20} color={scheme.onSurfaceVariant} />
              </Pressable>
            </View>

            <View style={styles.modalActions}>
              <Pressable
                onPress={handleBuyKoleo}
                style={({ pressed }) => [
                  styles.actionTile,
                  styles.koleoTile,
                  pressed && styles.tilePressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={s.railTickets.buyKoleo}
              >
                <View style={styles.actionIconBoxPrimary}>
                  <TrainFront size={20} color={scheme.onPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitlePrimary}>{s.railTickets.buyKoleo}</Text>
                  <Text style={styles.actionDescPrimary}>{s.railTickets.koleoDesc}</Text>
                </View>
                <ExternalLink size={16} color={scheme.primary} />
              </Pressable>

              <Pressable
                onPress={handleAttachPdf}
                disabled={importing}
                style={({ pressed }) => [
                  styles.actionTile,
                  styles.pdfTile,
                  pressed && styles.tilePressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={s.railTickets.attachPdf}
              >
                <View style={styles.actionIconBoxSecondary}>
                  {importing ? (
                    <ActivityIndicator size="small" color={scheme.secondary} />
                  ) : (
                    <FileUp size={20} color={scheme.secondary} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionTitleSecondary}>
                    {importing ? s.railTickets.loading : s.railTickets.attachPdf}
                  </Text>
                  <Text style={styles.actionDescSecondary}>{s.railTickets.attachPdfDesc}</Text>
                </View>
                <ChevronRight size={16} color={scheme.onSurfaceVariant} />
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  deckPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.full,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    paddingVertical: 5,
    paddingHorizontal: 6,
    minHeight: 52,
    ...elev.level1,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: shape.full,
    gap: 10,
  },
  ticketSegment: {},
  transferSegment: {},
  transferSegmentWarning: {
    backgroundColor: scheme.warningContainer,
    borderRadius: shape.full,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: scheme.outlineVariant,
    marginHorizontal: 2,
  },
  iconBadge: {
    width: 34,
    height: 34,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketBadgeEmpty: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  ticketBadgeAttached: {
    backgroundColor: scheme.primaryContainer,
  },
  transferBadgeInactive: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  transferBadgeSafe: {
    backgroundColor: scheme.primaryContainer,
  },
  transferBadgeActive: {
    backgroundColor: scheme.secondaryContainer,
  },
  transferBadgeWarning: {
    backgroundColor: scheme.onWarningContainer + '26',
  },
  segmentTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  segmentTitle: {
    fontSize: 13,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onSurface,
    letterSpacing: -0.2,
  },
  segmentTitleActive: {
    color: scheme.onSurface,
  },
  segmentTitleWarning: {
    color: scheme.onWarningContainer,
  },
  segmentSubtitle: {
    fontSize: 11,
    fontFamily: 'Manrope_500Medium',
    color: scheme.onSurfaceVariant,
    marginTop: 1,
  },
  segmentSubtitleActive: {
    color: scheme.primary,
    fontFamily: 'Manrope_600SemiBold',
  },
  segmentSubtitleTicketAttached: {
    color: scheme.primary,
    fontFamily: 'Manrope_600SemiBold',
  },
  segmentSubtitleWarning: {
    color: scheme.onWarningContainer,
    fontFamily: 'Manrope_700Bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 36,
    gap: 16,
    ...elev.level3,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalHeading: {
    fontSize: 18,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onSurface,
  },
  modalSubheading: {
    fontSize: 13,
    fontFamily: 'Manrope_500Medium',
    color: scheme.onSurfaceVariant,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHighest,
  },
  modalActions: {
    gap: 12,
  },
  actionTile: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: shape.large,
    gap: 14,
    borderWidth: 1,
  },
  koleoTile: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  pdfTile: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderColor: scheme.outlineVariant,
  },
  tilePressed: {
    opacity: 0.75,
  },
  actionIconBoxPrimary: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBoxSecondary: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitlePrimary: {
    fontSize: 15,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onPrimaryContainer,
  },
  actionDescPrimary: {
    fontSize: 12,
    fontFamily: 'Manrope_500Medium',
    color: scheme.onPrimaryContainer,
    opacity: 0.85,
    marginTop: 2,
  },
  actionTitleSecondary: {
    fontSize: 15,
    fontFamily: 'Manrope_700Bold',
    color: scheme.onSurface,
  },
  actionDescSecondary: {
    fontSize: 12,
    fontFamily: 'Manrope_500Medium',
    color: scheme.onSurfaceVariant,
    marginTop: 2,
  },
});
