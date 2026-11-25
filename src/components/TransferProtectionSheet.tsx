import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ArrowRight,
  BusFront,
  CableCar,
  Check,
  Clock3,
  Footprints,
  LocateFixed,
  Power,
  RefreshCw,
  Sensors,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  TrainFront,
  TramFront,
  X,
} from './icons';
import { useStrings, type Strings } from '../i18n';
import { scheme } from '../theme/tokens';
import type { Connection, Leg } from '../types/models';
import { clockFromMs } from '../services/notifications/format';
import type {
  TransferAlternative,
  TransferProtectionState,
  TransferSegmentSummary,
} from '../services/notifications/transferTypes';
import {
  TransferAction,
  formatSlackLabel,
  transferTitle,
  transferTone,
} from './TransferProtectionCard';

function ModeIcon({
  mode,
  size = 16,
  color = scheme.onSurface,
}: {
  mode?: Leg['mode'];
  size?: number;
  color?: string;
}) {
  switch (mode) {
    case 'tram':
      return <TramFront size={size} color={color} />;
    case 'train':
      return <TrainFront size={size} color={color} />;
    case 'cable':
      return <CableCar size={size} color={color} />;
    case 'walk':
      return <Footprints size={size} color={color} />;
    default:
      return <BusFront size={size} color={color} />;
  }
}

function strategyLabel(alt: TransferAlternative, currentLine: string | undefined, s: Strings): string {
  if (alt.source === 'legSwap') return s.transferGuard.strategyLegSwap;
  if (alt.kind === 'stayOn') {
    return currentLine
      ? s.transferGuard.stayUntil(currentLine, alt.transferStop)
      : s.transferGuard.strategyStayOn;
  }
  return s.transferGuard.strategySameStop;
}

function deltaLabel(alt: TransferAlternative, s: Strings): { text: string; tone: 'good' | 'neutral' | 'late' } | null {
  if (alt.deltaArrivalMin == null) return null;
  if (alt.deltaArrivalMin < 0) {
    return { text: s.transferGuard.optionEarlier(-alt.deltaArrivalMin), tone: 'good' };
  }
  if (alt.deltaArrivalMin === 0) {
    return { text: s.transferGuard.optionSameTime, tone: 'neutral' };
  }
  return { text: s.transferGuard.optionLater(alt.deltaArrivalMin), tone: 'late' };
}

function TransferBufferGauge({
  slackSec,
  bufferSec,
}: {
  slackSec?: number;
  bufferSec?: number;
}) {
  if (slackSec == null) return null;
  const target = Math.max(120, (bufferSec ?? 180) * 2.5);
  const ratio = Math.max(0.06, Math.min(1, (slackSec + 120) / (target + 120)));
  const fillColor =
    slackSec < 0
      ? scheme.error
      : slackSec < (bufferSec ?? 180)
        ? scheme.warning
        : scheme.success;

  return (
    <View style={styles.gaugeTrack} accessibilityElementsHidden>
      <View style={[styles.gaugeFill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: fillColor }]} />
    </View>
  );
}

function MultiTransferStrip({
  transfers,
  s,
}: {
  transfers: TransferSegmentSummary[];
  s: Strings;
}) {
  if (transfers.length <= 1) return null;
  return (
    <View style={styles.stripBlock}>
      <Text style={styles.sectionLabel}>{s.transferGuard.transfersStripTitle}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stripRow}
      >
        {transfers.map((item) => {
          const isCurrent = item.state === 'active';
          const isDone = item.state === 'passed';
          const pillTone =
            isCurrent
              ? styles.stripPillCurrent
              : isDone
                ? styles.stripPillDone
                : styles.stripPillUpcoming;
          const textColor = isCurrent
            ? scheme.onPrimaryContainer
            : isDone
              ? scheme.onSurfaceVariant
              : scheme.onSurface;
          const statusTag = isDone
            ? s.transferGuard.transferStatusDone
            : isCurrent
              ? s.transferGuard.transferStatusNow
              : s.transferGuard.transferStatusUpcoming;
          return (
            <View key={`${item.legIndex}-${item.nextLegIndex}`} style={[styles.stripPill, pillTone]}>
              <View style={styles.stripHeader}>
                <Text style={[styles.stripLines, { color: textColor }]}>
                  {item.fromLine} → {item.toLine}
                </Text>
                <Text style={[styles.stripStatus, { color: textColor }]}>{statusTag}</Text>
              </View>
              <Text style={[styles.stripStop, { color: textColor }]} numberOfLines={1}>
                {item.transferStop}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function TransferProtectionSheet({
  connection,
  state,
  onClose,
  onAccept,
  onPauseProtection,
  onRefresh,
  onStop,
}: {
  connection: Connection;
  state: TransferProtectionState;
  onClose: () => void;
  onAccept: (alternativeId: string) => Promise<boolean>;
  onPauseProtection?: () => void;
  onRefresh?: () => Promise<void> | void;
  onStop: () => void;
}) {
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const alternatives = useMemo<TransferAlternative[]>(() => {
    const raw =
      state.alternatives && state.alternatives.length > 0
        ? state.alternatives
        : state.alternative
          ? [state.alternative]
          : [];
    return raw.filter((alt) => alt.validUntil > now);
  }, [state.alternatives, state.alternative, now]);

  const [selectedId, setSelectedId] = useState<string | null>(alternatives[0]?.id ?? null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setError(null);
    if (alternatives.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !alternatives.some((alt) => alt.id === selectedId)) {
      setSelectedId(alternatives[0].id);
    }
  }, [alternatives, selectedId]);

  const selectedAlternative =
    alternatives.find((alt) => alt.id === selectedId) ?? alternatives[0];

  const tone = transferTone(state);
  const heroBg =
    tone === 'danger'
      ? scheme.errorContainer
      : tone === 'warning'
        ? scheme.warningContainer
        : tone === 'safe'
          ? scheme.successContainer
          : scheme.surfaceContainerHigh;
  const heroFg =
    tone === 'danger'
      ? scheme.onErrorContainer
      : tone === 'warning'
        ? scheme.onWarningContainer
        : tone === 'safe'
          ? scheme.onSuccessContainer
          : scheme.onSurface;
  const HeroIcon =
    tone === 'danger' || tone === 'warning' || state.status === 'unavailable'
      ? ShieldAlert
      : ShieldCheck;

  const slackLabel = formatSlackLabel(state, s);
  const delayMin = state.delaySec ? Math.round(state.delaySec / 60) : 0;
  const walkMin = state.walkSec ? Math.max(1, Math.round(state.walkSec / 60)) : 0;
  const walkM = state.walkM ?? 0;

  const telemetryBadge =
    state.delaySource === 'gps'
      ? { icon: LocateFixed, text: s.transferGuard.sourceGps }
      : state.delaySource === 'live' || state.departureSource === 'live'
        ? { icon: Sensors, text: s.transferGuard.sourceLive }
        : { icon: Clock3, text: s.transferGuard.sourceSchedule };
  const TelemetryIcon = telemetryBadge.icon;

  const hasCorridor = Boolean(state.currentLine && state.nextLine);
  const arrivalClock = state.arrivalAtMs ? clockFromMs(state.arrivalAtMs) : null;
  const departureClock = state.departureAtMs ? clockFromMs(state.departureAtMs) : null;

  const accept = async () => {
    if (!selectedAlternative) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await onAccept(selectedAlternative.id);
      if (ok) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
      } else {
        setError(s.transferGuard.acceptError);
      }
    } catch {
      setError(s.transferGuard.acceptError);
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    void Haptics.selectionAsync().catch(() => {});
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const statusBody =
    state.status === 'rerouting'
      ? s.transferGuard.rerouting
      : state.status === 'noAlternative'
        ? s.transferGuard.noAlternative
        : state.status === 'conductor'
          ? s.transferGuard.conductorBody
          : state.status === 'unavailable'
            ? state.reason === 'routing'
              ? s.transferGuard.routingError
              : s.transferGuard.unavailableBody
            : state.status === 'alternative'
              ? s.transferGuard.alternativeBody
              : state.status === 'waiting'
                ? s.transferGuard.waiting
                : state.status === 'complete'
                  ? s.transferGuard.complete
                  : null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          accessibilityLabel={s.common.close}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: Math.max(20, insets.bottom + 12) }]}
        >
          <View style={styles.handle} />

          {/* Header bar */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.headerBadge, { backgroundColor: heroBg }]}>
                <HeroIcon size={20} color={heroFg} />
              </View>
              <View style={styles.headerText}>
                <Text style={styles.headerEyebrow}>{s.transferGuard.title}</Text>
                <View style={styles.telemetryPill}>
                  <TelemetryIcon size={12} color={scheme.primary} />
                  <Text style={styles.telemetryText}>{telemetryBadge.text}</Text>
                </View>
              </View>
            </View>
            <View style={styles.headerActions}>
              {onRefresh && (
                <Pressable
                  onPress={handleRefresh}
                  disabled={refreshing}
                  accessibilityRole="button"
                  accessibilityLabel={s.transferGuard.refreshAction}
                  style={styles.iconBtn}
                >
                  {refreshing ? (
                    <ActivityIndicator size="small" color={scheme.primary} />
                  ) : (
                    <RefreshCw size={18} color={scheme.onSurfaceVariant} />
                  )}
                </Pressable>
              )}
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={s.common.close}
                style={styles.iconBtn}
              >
                <X size={20} color={scheme.onSurfaceVariant} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Status headline banner */}
            <View style={[styles.statusHero, { backgroundColor: heroBg }]}>
              <Text style={[styles.heroTitle, { color: heroFg }]}>
                {transferTitle(state, s)}
              </Text>
              {statusBody && (
                <Text style={[styles.heroBody, { color: heroFg }]}>{statusBody}</Text>
              )}
              {state.swappedByUser && (
                <View style={styles.swappedChip}>
                  <Check size={13} color={heroFg} />
                  <Text style={[styles.swappedChipText, { color: heroFg }]}>
                    {s.transferGuard.swappedNotice}
                  </Text>
                </View>
              )}
            </View>

            {/* Visual Transfer Corridor + Buffer Gauge */}
            {hasCorridor && (
              <View style={styles.corridorCard}>
                <View style={styles.corridorNodes}>
                  {/* Incoming leg */}
                  <View style={styles.nodeCol}>
                    <View style={styles.lineChip}>
                      <ModeIcon mode={state.currentMode} size={15} color={scheme.onPrimaryContainer} />
                      <Text style={styles.lineChipText}>{state.currentLine}</Text>
                    </View>
                    <Text style={styles.nodeCaption}>{s.transferGuard.corridorArrival}</Text>
                    <Text style={styles.nodeTime}>{arrivalClock ?? connection.departAt}</Text>
                    <Text
                      style={[
                        styles.nodeMeta,
                        delayMin >= 2 ? styles.nodeMetaWarn : styles.nodeMetaGood,
                      ]}
                    >
                      {delayMin >= 1 ? s.transferGuard.delay(delayMin) : s.transferGuard.onTime}
                    </Text>
                  </View>

                  {/* Transfer bridge */}
                  <View style={styles.bridgeCol}>
                    <ArrowRight size={18} color={scheme.onSurfaceVariant} />
                    {slackLabel && (
                      <Text
                        style={[
                          styles.bridgeSlack,
                          state.slackSec != null && state.slackSec < 0
                            ? styles.bridgeSlackDanger
                            : state.slackSec != null &&
                                state.slackSec < (state.bufferSec ?? 180)
                              ? styles.bridgeSlackWarn
                              : styles.bridgeSlackSafe,
                        ]}
                        numberOfLines={2}
                      >
                        {slackLabel}
                      </Text>
                    )}
                    <Text style={styles.bridgeWalk} numberOfLines={1}>
                      {walkM > 20
                        ? s.transferGuard.walkTransfer(walkMin, walkM)
                        : s.transferGuard.samePlatform}
                    </Text>
                  </View>

                  {/* Outgoing leg */}
                  <View style={[styles.nodeCol, styles.nodeColRight]}>
                    <View
                      style={[
                        styles.lineChip,
                        state.nextMode === 'train' && styles.lineChipTrain,
                      ]}
                    >
                      <ModeIcon
                        mode={state.nextMode}
                        size={15}
                        color={
                          state.nextMode === 'train'
                            ? scheme.onTertiaryContainer
                            : scheme.onPrimaryContainer
                        }
                      />
                      <Text
                        style={[
                          styles.lineChipText,
                          state.nextMode === 'train' && styles.lineChipTrainText,
                        ]}
                      >
                        {state.nextLine}
                      </Text>
                    </View>
                    <Text style={styles.nodeCaption}>{s.transferGuard.corridorDeparture}</Text>
                    <Text style={styles.nodeTime}>{departureClock ?? connection.arriveAt}</Text>
                    <Text style={styles.nodeMeta}>
                      {state.departureSource === 'live'
                        ? s.transferGuard.sourceLive
                        : s.transferGuard.sourceSchedule}
                    </Text>
                  </View>
                </View>

                <TransferBufferGauge slackSec={state.slackSec} bufferSec={state.bufferSec} />

                {state.transferStop && (
                  <View style={styles.stopFooter}>
                    <Text style={styles.stopFooterName} numberOfLines={1}>
                      {state.transferStop}
                    </Text>
                    <Text style={styles.stopFooterArrival}>
                      {s.transferGuard.arrival} {connection.arriveAt}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Multi-transfer strip */}
            {state.transfers && state.transfers.length > 1 && (
              <MultiTransferStrip transfers={state.transfers} s={s} />
            )}

            {/* Conductor / Train missed transfer card */}
            {state.status === 'conductor' && (
              <View style={styles.conductorCard}>
                <View style={styles.conductorHeader}>
                  <TrainFront size={20} color={scheme.onTertiaryContainer} />
                  <Text style={styles.conductorNote}>{s.transferGuard.trainNoSwapNote}</Text>
                </View>
                {state.nextTrain && (
                  <View style={styles.nextTrainBox}>
                    <Text style={styles.nextTrainEyebrow}>{s.transferGuard.nextTrainLabel}</Text>
                    <View style={styles.nextTrainRow}>
                      <Text style={styles.nextTrainLine}>{state.nextTrain.label}</Text>
                      <Text style={styles.nextTrainTime}>
                        {s.transferGuard.nextTrainAt(clockFromMs(state.nextTrain.departAtMs))}
                      </Text>
                    </View>
                    {state.nextTrain.trainName ? (
                      <Text style={styles.nextTrainDirection} numberOfLines={1}>
                        {state.nextTrain.trainName}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>
            )}

            {/* Selectable urban alternatives (up to 3) */}
            {alternatives.length > 0 && (
              <View style={styles.alternativesSection}>
                <View style={styles.alternativesHeader}>
                  <Text style={styles.sectionLabel}>{s.transferGuard.alternativesHeading}</Text>
                  <View style={styles.countChip}>
                    <Text style={styles.countChipText}>
                      {s.transferGuard.alternativesCount(alternatives.length)}
                    </Text>
                  </View>
                </View>

                <View style={styles.alternativesList}>
                  {alternatives.map((alt, idx) => {
                    const isSelected = alt.id === selectedAlternative?.id;
                    const delta = deltaLabel(alt, s);
                    const altSlackMin =
                      alt.slackSec != null ? Math.max(0, Math.floor(alt.slackSec / 60)) : null;
                    return (
                      <Pressable
                        key={alt.id}
                        onPress={() => {
                          void Haptics.selectionAsync().catch(() => {});
                          setSelectedId(alt.id);
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected }}
                        style={[styles.altCard, isSelected && styles.altCardSelected]}
                      >
                        <View style={styles.altTop}>
                          <View style={styles.altLineGroup}>
                            <View style={[styles.altLinePill, isSelected && styles.altLinePillSelected]}>
                              <ModeIcon
                                mode={alt.nextMode}
                                size={15}
                                color={isSelected ? scheme.onPrimary : scheme.onSecondaryContainer}
                              />
                              <Text
                                style={[
                                  styles.altLineText,
                                  isSelected && styles.altLineTextSelected,
                                ]}
                              >
                                {alt.nextLine}
                              </Text>
                            </View>
                            {idx === 0 && (
                              <View style={styles.recommendedPill}>
                                <Text style={styles.recommendedText}>
                                  {s.transferGuard.recommendedBadge}
                                </Text>
                              </View>
                            )}
                          </View>
                          <View style={styles.altRight}>
                            <Text style={styles.altArrival}>
                              {s.transferGuard.arrival} {clockFromMs(alt.arrivalAtMs)}
                            </Text>
                            {delta && (
                              <Text
                                style={[
                                  styles.altDelta,
                                  delta.tone === 'good'
                                    ? styles.altDeltaGood
                                    : delta.tone === 'late'
                                      ? styles.altDeltaLate
                                      : styles.altDeltaNeutral,
                                ]}
                              >
                                {delta.text}
                              </Text>
                            )}
                          </View>
                        </View>

                        <Text style={styles.altStrategy} numberOfLines={2}>
                          {strategyLabel(alt, state.currentLine, s)}
                        </Text>

                        <View style={styles.altMetaRow}>
                          <Text style={styles.altMetaChip} numberOfLines={1}>
                            {s.transferGuard.departure} {clockFromMs(alt.departureAtMs)} ·{' '}
                            {alt.transferStop}
                          </Text>
                          {altSlackMin != null && (
                            <Text style={styles.altSlackChip}>
                              {altSlackMin === 0
                                ? s.transferGuard.tightTransfer
                                : s.transferGuard.spare(altSlackMin)}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.unchangedHint}>{s.transferGuard.unchanged}</Text>
              </View>
            )}

            {/* Expired / error notice */}
            {state.status === 'alternative' && alternatives.length === 0 && (
              <Text style={styles.notice}>{s.transferGuard.expired}</Text>
            )}
            {error && <Text style={styles.errorText}>{error}</Text>}

            {/* Primary & Secondary CTAs */}
            <View style={styles.ctaStack}>
              {selectedAlternative && (
                <TransferAction
                  label={s.transferGuard.choose}
                  onPress={accept}
                  disabled={busy}
                  style={styles.primaryCta}
                >
                  {busy ? (
                    <ActivityIndicator color={scheme.onPrimary} />
                  ) : (
                    <Check size={20} color={scheme.onPrimary} />
                  )}
                  <Text style={styles.primaryCtaText}>{s.transferGuard.choose}</Text>
                </TransferAction>
              )}

              <TransferAction
                label={selectedAlternative ? s.transferGuard.keepPlan : s.transferGuard.later}
                onPress={onClose}
                disabled={busy}
                style={styles.secondaryCta}
              >
                <Text style={styles.secondaryCtaText}>
                  {selectedAlternative ? s.transferGuard.keepPlan : s.transferGuard.later}
                </Text>
              </TransferAction>
            </View>

            {/* Footer controls: separate Pause Protection vs Stop Journey */}
            <View style={styles.footerRow}>
              {onPauseProtection && (
                <Pressable
                  onPress={onPauseProtection}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={s.transferGuard.pauseProtection}
                  style={styles.footerBtn}
                >
                  <ShieldOff size={16} color={scheme.onSurfaceVariant} />
                  <Text style={styles.footerBtnText}>{s.transferGuard.pauseProtection}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={onStop}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={s.transferGuard.stop}
                style={[styles.footerBtn, styles.footerBtnDanger]}
              >
                <Power size={16} color={scheme.error} />
                <Text style={[styles.footerBtnText, styles.footerBtnDangerText]}>
                  {s.transferGuard.stop}
                </Text>
              </Pressable>
            </View>

            <Text style={styles.scopeNote}>
              {state.scope === 'background'
                ? s.transferGuard.background
                : s.transferGuard.foreground}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: scheme.scrim + 'B3',
    justifyContent: 'flex-end',
  },
  dismissArea: { flex: 1 },
  sheet: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '90%',
    alignSelf: 'center',
    backgroundColor: scheme.surfaceContainerLow,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: scheme.outlineVariant,
    paddingTop: 10,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: scheme.outline,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  headerBadge: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { gap: 3, flex: 1, minWidth: 0 },
  headerEyebrow: {
    fontSize: 15,
    fontWeight: '700',
    color: scheme.onSurface,
    letterSpacing: -0.2,
  },
  telemetryPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  telemetryText: { fontSize: 12, fontWeight: '600', color: scheme.primary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 8, gap: 14 },
  statusHero: {
    borderRadius: 24,
    padding: 16,
    gap: 6,
  },
  heroTitle: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  heroBody: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  swappedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  swappedChipText: { fontSize: 12, fontWeight: '600' },

  corridorCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    padding: 16,
    gap: 14,
  },
  corridorNodes: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  nodeCol: { flex: 1, gap: 3, alignItems: 'flex-start' },
  nodeColRight: { alignItems: 'flex-end' },
  lineChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.primaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 4,
  },
  lineChipTrain: { backgroundColor: scheme.tertiaryContainer },
  lineChipText: { fontSize: 14, fontWeight: '800', color: scheme.onPrimaryContainer },
  lineChipTrainText: { color: scheme.onTertiaryContainer },
  nodeCaption: { fontSize: 11, fontWeight: '600', color: scheme.onSurfaceVariant },
  nodeTime: { fontSize: 22, fontWeight: '800', color: scheme.onSurface, letterSpacing: -0.5 },
  nodeMeta: { fontSize: 12, fontWeight: '600', color: scheme.onSurfaceVariant },
  nodeMetaGood: { color: scheme.success },
  nodeMetaWarn: { color: scheme.warning },

  bridgeCol: {
    flex: 1.15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 6,
    gap: 4,
  },
  bridgeSlack: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
  bridgeSlackSafe: { color: scheme.success },
  bridgeSlackWarn: { color: scheme.warning },
  bridgeSlackDanger: { color: scheme.error },
  bridgeWalk: { fontSize: 11, fontWeight: '500', color: scheme.onSurfaceVariant, textAlign: 'center' },

  gaugeTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: scheme.surfaceContainerHighest,
    overflow: 'hidden',
  },
  gaugeFill: { height: '100%', borderRadius: 999 },

  stopFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 2,
  },
  stopFooterName: { flex: 1, fontSize: 13, fontWeight: '600', color: scheme.onSurface },
  stopFooterArrival: { fontSize: 12, fontWeight: '600', color: scheme.onSurfaceVariant },

  stripBlock: { gap: 8 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: scheme.onSurfaceVariant,
  },
  stripRow: { gap: 8, paddingRight: 4 },
  stripPill: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 132,
    maxWidth: 190,
    gap: 3,
    borderWidth: 1,
  },
  stripPillCurrent: {
    backgroundColor: scheme.primaryContainer,
    borderColor: scheme.primary,
  },
  stripPillDone: {
    backgroundColor: scheme.surfaceContainer,
    borderColor: scheme.outlineVariant,
    opacity: 0.72,
  },
  stripPillUpcoming: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderColor: scheme.outlineVariant,
  },
  stripHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stripLines: { fontSize: 13, fontWeight: '800' },
  stripStatus: { fontSize: 11, fontWeight: '600' },
  stripStop: { fontSize: 12, fontWeight: '500' },

  conductorCard: {
    backgroundColor: scheme.tertiaryContainer,
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  conductorHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  conductorNote: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: scheme.onTertiaryContainer,
  },
  nextTrainBox: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  nextTrainEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: scheme.onSurfaceVariant,
  },
  nextTrainRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  nextTrainLine: { fontSize: 18, fontWeight: '800', color: scheme.onSurface },
  nextTrainTime: { fontSize: 15, fontWeight: '700', color: scheme.primary },
  nextTrainDirection: { fontSize: 13, color: scheme.onSurfaceVariant },

  alternativesSection: { gap: 10 },
  alternativesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  countChip: {
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  countChipText: { fontSize: 11, fontWeight: '700', color: scheme.onSecondaryContainer },
  alternativesList: { gap: 10 },
  altCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: scheme.outlineVariant,
    padding: 14,
    gap: 8,
  },
  altCardSelected: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderColor: scheme.primary,
  },
  altTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  altLineGroup: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  altLinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  altLinePillSelected: { backgroundColor: scheme.primary },
  altLineText: { fontSize: 14, fontWeight: '800', color: scheme.onSecondaryContainer },
  altLineTextSelected: { color: scheme.onPrimary },
  recommendedPill: {
    backgroundColor: scheme.primaryContainer,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  recommendedText: { fontSize: 11, fontWeight: '700', color: scheme.onPrimaryContainer },
  altRight: { alignItems: 'flex-end', gap: 2 },
  altArrival: { fontSize: 14, fontWeight: '800', color: scheme.onSurface },
  altDelta: { fontSize: 12, fontWeight: '700' },
  altDeltaGood: { color: scheme.success },
  altDeltaNeutral: { color: scheme.primary },
  altDeltaLate: { color: scheme.warning },
  altStrategy: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: scheme.onSurface },
  altMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  altMetaChip: { flex: 1, fontSize: 12, color: scheme.onSurfaceVariant },
  altSlackChip: { fontSize: 12, fontWeight: '700', color: scheme.primary },
  unchangedHint: { fontSize: 12, lineHeight: 17, color: scheme.onSurfaceVariant },

  notice: { fontSize: 13, lineHeight: 19, color: scheme.warning, fontWeight: '600' },
  errorText: { fontSize: 13, lineHeight: 19, color: scheme.error, fontWeight: '600' },

  ctaStack: { gap: 10, paddingTop: 2 },
  primaryCta: { backgroundColor: scheme.primary, borderColor: scheme.primary },
  primaryCtaText: { fontSize: 15, fontWeight: '700', color: scheme.onPrimary },
  secondaryCta: { backgroundColor: scheme.secondaryContainer, borderColor: 'transparent' },
  secondaryCtaText: { fontSize: 15, fontWeight: '700', color: scheme.onSecondaryContainer },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 4,
  },
  footerBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    backgroundColor: scheme.surfaceContainer,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  footerBtnDanger: { borderColor: scheme.error + '55' },
  footerBtnText: { fontSize: 13, fontWeight: '600', color: scheme.onSurfaceVariant },
  footerBtnDangerText: { color: scheme.error },

  scopeNote: {
    fontSize: 12,
    lineHeight: 17,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    paddingTop: 2,
  },
});
