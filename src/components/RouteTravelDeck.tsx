import { memo, useEffect, useRef, useState } from 'react';
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
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  AlertCircle,
  ChevronRight,
  ExternalLink,
  FileDoc,
  FileUp,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  TrainFront,
  X,
} from './icons';
import { useStrings } from '../i18n';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import type { TransferProtectionState } from '../services/notifications/transferTypes';
import {
  checkTicketCompensation,
  isTransferProtectionSupported,
} from '../services/notifications';
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
  /** Odracza odczyt biletu z dysku do końca animacji otwarcia ekranu. */
  deferLoad?: boolean;
};

export const RouteTravelDeck = memo(function RouteTravelDeck({
  connection,
  hasTransfers,
  transferState,
  transferActive,
  trackingBusy,
  onTransferPress,
  autoInspectTicket = false,
  deferLoad = false,
}: RouteTravelDeckProps) {
  const s = useStrings();
  const [ticket, setTicket] = useState<AttachedRailTicket | null>(null);
  const [ticketSheetOpen, setTicketSheetOpen] = useState(false);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rejection, setRejection] = useState<TicketImportRejected | null>(null);
  const importInFlight = useRef(false);
  const autoInspectDone = useRef(false);

  const isTrainTrip = hasTrainLegs(connection);
  const trainSummary = getTrainLegSummary(connection);
  const showTicketSegment = isTrainTrip && trainSummary !== null;
  const showTransferSegment = hasTransfers && isTransferProtectionSupported();
  const isDual = showTicketSegment && showTransferSegment;

  useEffect(() => {
    if (!showTicketSegment) {
      setTicket(null);
      autoInspectDone.current = false;
      return;
    }
    if (deferLoad && !autoInspectTicket) return;
    let active = true;
    setTicket(null);
    autoInspectDone.current = false;
    const loadTicket = () => {
      void getTicketForConnection(connection.id, connection).then((t) => {
        if (!active) return;
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
  }, [connection.id, connection.serviceDate, showTicketSegment, deferLoad, autoInspectTicket]);

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

  const isWarning = transferActive && transferNeedsAttention(transferState);
  const isSafe = transferActive && transferState?.status === 'safe';
  const slackMin = Math.max(0, Math.floor((transferState?.slackSec ?? 0) / 60));

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
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
                      () => {},
                    );
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
        try {
          await RoutingService.saveRoute(connection);
        } catch (err) {
          console.warn('[RouteTravelDeck] saveRoute for ticket failed:', err);
        }
        void checkTicketCompensation();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        if (ticketHasBarcode(imported)) {
          setInspectionOpen(true);
        } else {
          Alert.alert(s.railTickets.attachedTitle, s.railTickets.importSuccess);
        }
      } else if (result.status === 'rejected') {
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
  const seatLabel = seatParts.length > 0 ? seatParts.join(' \u00b7 ') : null;

  const ticketSubtitle = ticket
    ? (seatLabel ?? (meta?.passenger ? meta.passenger : s.railTickets.showShort))
    : s.railTickets.buyOrAdd;

  const corridorText =
    transferActive && transferState?.currentLine && transferState?.nextLine
      ? `${transferState.currentLine} → ${transferState.nextLine}`
      : null;
  const altCount =
    transferState?.alternatives?.length ?? (transferState?.alternative ? 1 : 0);
  const transferTitle = isWarning
    ? transferState?.status === 'conductor'
      ? s.transferGuard.conductorTitle
      : s.travelDeck.transferAlert
    : corridorText ?? s.travelDeck.protection;
  const transferSubtitle = !transferActive
    ? s.travelDeck.protectionEnable
    : transferState?.status === 'alternative' && altCount > 0
      ? s.transferGuard.alternativesCount(altCount)
      : transferState?.status === 'conductor'
        ? s.transferGuard.conductorBody
        : isWarning
          ? transferState?.slackSec != null && transferState.slackSec < 0
            ? s.transferGuard.shortBy(Math.max(1, Math.ceil(-transferState.slackSec / 60)))
            : s.travelDeck.protectionAtRisk
          : isSafe
            ? s.travelDeck.protectionSlack(slackMin)
            : s.travelDeck.protectionWatching;

  const ticketIcon = ticket ? (
    ticketHasBarcode(ticket) ? (
      <ScanLine size={19} color={scheme.onPrimaryContainer} />
    ) : (
      <TrainFront size={19} color={scheme.onPrimaryContainer} />
    )
  ) : (
    <TrainFront size={19} color={scheme.onSecondaryContainer} />
  );

  const transferIcon = trackingBusy ? (
    <ActivityIndicator size="small" color={scheme.primary} />
  ) : !transferActive ? (
    <ShieldOff size={19} color={scheme.onSurfaceVariant} />
  ) : isWarning ? (
    <ShieldAlert size={19} color={scheme.onWarningContainer} />
  ) : (
    <ShieldCheck size={19} color={scheme.onPrimaryContainer} />
  );

  return (
    <View style={styles.container}>
      <View style={styles.deckGrid}>
        {/* SEGMENT 1: BILET KOLEJOWY (tylko trasy z pociągiem) */}
        {showTicketSegment && (
          <DeckSegmentButton
            onPress={handleTicketPress}
            onLongPress={handleTicketLongPress}
            accessibilityLabel={`${ticketTitle}, ${ticketSubtitle}`}
            style={[
              isDual ? styles.bentoCard : styles.singleCard,
              ticket ? styles.cardPrimaryTonal : styles.cardNeutral,
            ]}
          >
            {isDual ? (
              <>
                <View style={styles.bentoTopRow}>
                  <View
                    style={[
                      styles.iconBadge,
                      ticket ? styles.ticketBadgeAttached : styles.ticketBadgeEmpty,
                    ]}
                  >
                    {ticketIcon}
                  </View>
                  <View
                    style={[
                      styles.chevronPill,
                      ticket ? styles.chevronPillPrimary : styles.chevronPillNeutral,
                    ]}
                  >
                    <ChevronRight
                      size={15}
                      color={ticket ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                    />
                  </View>
                </View>

                <View style={styles.bentoTextCol}>
                  <Text
                    style={[styles.segmentTitle, ticket && styles.segmentTitlePrimary]}
                    numberOfLines={1}
                  >
                    {ticketTitle}
                  </Text>
                  <Text
                    style={[
                      styles.segmentSubtitle,
                      ticket && styles.segmentSubtitlePrimary,
                    ]}
                    numberOfLines={2}
                  >
                    {ticketSubtitle}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View
                  style={[
                    styles.iconBadgeLarge,
                    ticket ? styles.ticketBadgeAttached : styles.ticketBadgeEmpty,
                  ]}
                >
                  {ticketIcon}
                </View>

                <View style={styles.segmentTextCol}>
                  <Text
                    style={[styles.segmentTitle, ticket && styles.segmentTitlePrimary]}
                    numberOfLines={1}
                  >
                    {ticketTitle}
                  </Text>
                  <Text
                    style={[
                      styles.segmentSubtitle,
                      ticket && styles.segmentSubtitlePrimary,
                    ]}
                    numberOfLines={1}
                  >
                    {ticketSubtitle}
                  </Text>
                </View>

                <View
                  style={[
                    styles.chevronPill,
                    ticket ? styles.chevronPillPrimary : styles.chevronPillNeutral,
                  ]}
                >
                  <ChevronRight
                    size={16}
                    color={ticket ? scheme.onPrimaryContainer : scheme.onSurfaceVariant}
                  />
                </View>
              </>
            )}
          </DeckSegmentButton>
        )}

        {/* SEGMENT 2: OCHRONA PRZESIADEK (trasy z co najmniej 1 przesiadką) */}
        {showTransferSegment && (
          <DeckSegmentButton
            onPress={onTransferPress}
            disabled={trackingBusy}
            accessibilityLabel={`${transferTitle}, ${transferSubtitle}`}
            style={[
              isDual ? styles.bentoCard : styles.singleCard,
              !transferActive && styles.cardNeutral,
              transferActive && !isWarning && styles.cardActiveTonal,
              isWarning && styles.cardWarningTonal,
            ]}
          >
            {isDual ? (
              <>
                <View style={styles.bentoTopRow}>
                  <View
                    style={[
                      styles.iconBadge,
                      !transferActive && styles.transferBadgeInactive,
                      transferActive && isSafe && styles.transferBadgeSafe,
                      transferActive && isWarning && styles.transferBadgeWarning,
                      transferActive && !isSafe && !isWarning && styles.transferBadgeActive,
                    ]}
                  >
                    {transferIcon}
                  </View>
                  <View
                    style={[
                      styles.chevronPill,
                      isWarning
                        ? styles.chevronPillWarning
                        : transferActive
                          ? styles.chevronPillActive
                          : styles.chevronPillNeutral,
                    ]}
                  >
                    <ChevronRight
                      size={15}
                      color={
                        isWarning
                          ? scheme.onWarningContainer
                          : transferActive
                            ? scheme.primary
                            : scheme.onSurfaceVariant
                      }
                    />
                  </View>
                </View>

                <View style={styles.bentoTextCol}>
                  <Text
                    style={[
                      styles.segmentTitle,
                      transferActive && !isWarning && styles.segmentTitleActive,
                      isWarning && styles.segmentTitleWarning,
                    ]}
                    numberOfLines={1}
                  >
                    {transferTitle}
                  </Text>
                  <Text
                    style={[
                      styles.segmentSubtitle,
                      transferActive && !isWarning && styles.segmentSubtitleActive,
                      isWarning && styles.segmentSubtitleWarning,
                    ]}
                    numberOfLines={2}
                  >
                    {transferSubtitle}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View
                  style={[
                    styles.iconBadgeLarge,
                    !transferActive && styles.transferBadgeInactive,
                    transferActive && isSafe && styles.transferBadgeSafe,
                    transferActive && isWarning && styles.transferBadgeWarning,
                    transferActive && !isSafe && !isWarning && styles.transferBadgeActive,
                  ]}
                >
                  {transferIcon}
                </View>

                <View style={styles.segmentTextCol}>
                  <Text
                    style={[
                      styles.segmentTitle,
                      transferActive && !isWarning && styles.segmentTitleActive,
                      isWarning && styles.segmentTitleWarning,
                    ]}
                    numberOfLines={1}
                  >
                    {transferTitle}
                  </Text>
                  <Text
                    style={[
                      styles.segmentSubtitle,
                      transferActive && !isWarning && styles.segmentSubtitleActive,
                      isWarning && styles.segmentSubtitleWarning,
                    ]}
                    numberOfLines={1}
                  >
                    {transferSubtitle}
                  </Text>
                </View>

                <View
                  style={[
                    styles.chevronPill,
                    isWarning
                      ? styles.chevronPillWarning
                      : transferActive
                        ? styles.chevronPillActive
                        : styles.chevronPillNeutral,
                  ]}
                >
                  <ChevronRight
                    size={16}
                    color={
                      isWarning
                        ? scheme.onWarningContainer
                        : transferActive
                          ? scheme.primary
                          : scheme.onSurfaceVariant
                    }
                  />
                </View>
              </>
            )}
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
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
              () => {},
            );
          }}
        />
      )}

      {/* ODRZUCENIE BILETU: dialog M3 z wyjaśnieniem */}
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

      {/* ARKUSZ SZYBKIEJ AKCJI BILETU (KOLEO / IMPORT PDF) */}
      {ticketSheetOpen && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setTicketSheetOpen(false)}
        >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setTicketSheetOpen(false)}
        >
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <View style={styles.sheetHandle} />

            <View style={styles.modalHeader}>
              <View style={styles.modalTitleCol}>
                <Text style={styles.modalHeading}>{s.railTickets.deckSheetTitle}</Text>
                {trainSummary && (
                  <Text style={styles.modalSubheading} numberOfLines={1}>
                    {trainSummary.fromStation}
                    {' \u2192 '}
                    {trainSummary.toStation}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => setTicketSheetOpen(false)}
                style={({ pressed }) => [styles.modalCloseBtn, pressed && styles.tilePressed]}
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
                <View style={styles.modalTitleCol}>
                  <Text style={styles.actionTitlePrimary}>{s.railTickets.buyKoleo}</Text>
                  <Text style={styles.actionDescPrimary}>{s.railTickets.koleoDesc}</Text>
                </View>
                <ExternalLink size={17} color={scheme.onPrimaryContainer} />
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
                    <ActivityIndicator size="small" color={scheme.onSecondaryContainer} />
                  ) : (
                    <FileUp size={20} color={scheme.onSecondaryContainer} />
                  )}
                </View>
                <View style={styles.modalTitleCol}>
                  <Text style={styles.actionTitleSecondary}>
                    {importing ? s.railTickets.loading : s.railTickets.attachPdf}
                  </Text>
                  <Text style={styles.actionDescSecondary}>{s.railTickets.attachPdfDesc}</Text>
                </View>
                <ChevronRight size={17} color={scheme.onSurfaceVariant} />
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  deckGrid: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  bentoCard: {
    flex: 1,
    padding: 14,
    borderRadius: 24,
    gap: 12,
    justifyContent: 'space-between',
    ...elev.level1,
  },
  singleCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 24,
    gap: 12,
    ...elev.level1,
  },
  cardNeutral: {
    backgroundColor: scheme.surfaceContainer,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  cardPrimaryTonal: {
    backgroundColor: scheme.primaryContainer,
  },
  cardActiveTonal: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.primary + '55',
  },
  cardWarningTonal: {
    backgroundColor: scheme.warningContainer,
  },
  bentoTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadgeLarge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ticketBadgeEmpty: {
    backgroundColor: scheme.secondaryContainer,
  },
  ticketBadgeAttached: {
    backgroundColor: scheme.primary + '2E',
  },
  transferBadgeInactive: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  transferBadgeSafe: {
    backgroundColor: scheme.primaryContainer,
  },
  transferBadgeActive: {
    backgroundColor: scheme.secondaryContainer,
  },
  transferBadgeWarning: {
    backgroundColor: scheme.onWarningContainer + '24',
  },
  chevronPill: {
    width: 28,
    height: 28,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronPillNeutral: {
    backgroundColor: scheme.surfaceContainerHigh,
  },
  chevronPillPrimary: {
    backgroundColor: scheme.onPrimaryContainer + '1A',
  },
  chevronPillActive: {
    backgroundColor: scheme.surfaceContainerLow,
  },
  chevronPillWarning: {
    backgroundColor: scheme.onWarningContainer + '1E',
  },
  bentoTextCol: {
    gap: 2,
  },
  segmentTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 2,
  },
  segmentTitle: {
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: scheme.onSurface,
  },
  segmentTitlePrimary: {
    color: scheme.onPrimaryContainer,
  },
  segmentTitleActive: {
    color: scheme.onSurface,
  },
  segmentTitleWarning: {
    color: scheme.onWarningContainer,
  },
  segmentSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  segmentSubtitleActive: {
    color: scheme.primary,
    fontWeight: '700',
  },
  segmentSubtitlePrimary: {
    color: scheme.onPrimaryContainer,
    fontWeight: '700',
  },
  segmentSubtitleWarning: {
    color: scheme.onWarningContainer,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: scheme.scrim + '88',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: scheme.surfaceContainer,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    borderTopWidth: 2,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    gap: 16,
    ...elev.level3,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.outlineVariant,
    marginBottom: 2,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  modalHeading: {
    ...type.titleMedium,
    fontSize: 18,
    fontWeight: '800',
    color: scheme.onSurface,
  },
  modalSubheading: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
  },
  modalActions: {
    gap: 12,
  },
  actionTile: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 68,
    padding: 15,
    borderRadius: 20,
    gap: 14,
  },
  koleoTile: {
    backgroundColor: scheme.primaryContainer,
  },
  pdfTile: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 2,
    borderColor: scheme.outlineVariant,
  },
  tilePressed: {
    opacity: 0.82,
  },
  actionIconBoxPrimary: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBoxSecondary: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTitlePrimary: {
    ...type.titleSmall,
    fontWeight: '800',
    color: scheme.onPrimaryContainer,
  },
  actionDescPrimary: {
    ...type.bodySmall,
    color: scheme.onPrimaryContainer,
    marginTop: 2,
  },
  actionTitleSecondary: {
    ...type.titleSmall,
    fontWeight: '800',
    color: scheme.onSurface,
  },
  actionDescSecondary: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    marginTop: 2,
  },
});
