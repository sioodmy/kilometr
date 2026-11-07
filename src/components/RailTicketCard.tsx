import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { ExternalLink, FileUp, ScanLine, Ticket, TrainFront, Trash2 } from './icons';
import { useStrings } from '../i18n';
import { scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';
import { getTrainLegSummary, hasTrainLegs, openKoleoRoute } from '../services/ticketing';
import {
  deleteTicketForConnection,
  getTicketForConnection,
  importTicketPdf,
  openTicketPdf,
  type AttachedRailTicket,
} from '../services/ticketStorage';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function SpringButton({
  children,
  onPress,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  disabled,
}: {
  children: React.ReactNode;
  onPress: () => void;
  style?: unknown;
  accessibilityLabel: string;
  accessibilityRole?: 'button' | 'link';
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const press = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - press.value * 0.02 }],
    opacity: 1 - press.value * 0.1,
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
      onPressIn={() => setPress(1)}
      onPressOut={() => setPress(0)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[style, animStyle, focused && styles.focusedRing]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function RailTicketCard({ connection }: { connection: Connection }) {
  const s = useStrings();
  const [ticket, setTicket] = useState<AttachedRailTicket | null>(null);
  const [loading, setLoading] = useState(false);

  const isTrainTrip = hasTrainLegs(connection);
  const summary = getTrainLegSummary(connection);

  useEffect(() => {
    let active = true;
    void getTicketForConnection(connection.id).then((t) => {
      if (active) setTicket(t);
    });
    return () => {
      active = false;
    };
  }, [connection.id]);

  if (!isTrainTrip || !summary) {
    return null;
  }

  const handleBuyKoleo = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await openKoleoRoute(connection);
  };

  const handleAttachPdf = async () => {
    try {
      setLoading(true);
      void Haptics.selectionAsync().catch(() => {});
      const imported = await importTicketPdf(connection.id, connection);
      if (imported) {
        setTicket(imported);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (err) {
      console.warn('[RailTicketCard] attach error:', err);
      Alert.alert(s.common.storageFailTitle, s.railTickets.importError);
    } finally {
      setLoading(false);
    }
  };

  const handleShowTicket = async () => {
    if (!ticket) return;
    void Haptics.selectionAsync().catch(() => {});
    await openTicketPdf(ticket);
  };

  const handleRemoveTicket = () => {
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
  };

  // ─── Stan 2: Bilet PDF dołączony do połączenia ───────────────────────────
  if (ticket) {
    const meta = ticket.metadata;
    const seatDetails = s.railTickets.attachedDetails(meta.wagon, meta.seat, meta.seatType);
    const primaryTitle = seatDetails || (meta.trainNumber ? `${s.railAlerts.fallbackLine} ${meta.trainNumber}` : s.railTickets.attachedTitle);
    const subtitle = meta.fromStation && meta.toStation
      ? s.railTickets.buyKoleoSub(meta.fromStation, meta.toStation)
      : s.railTickets.fileLabel(ticket.fileName);

    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconBadge}>
            <Ticket size={20} color={scheme.onPrimaryContainer} />
          </View>
          <View style={styles.content}>
            <Text style={styles.title} numberOfLines={1}>
              {primaryTitle}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          <View style={styles.actionsRow}>
            <SpringButton
              onPress={handleShowTicket}
              accessibilityLabel={s.railTickets.showTicket}
              style={styles.showButton}
            >
              <ScanLine size={16} color={scheme.onPrimaryContainer} />
              <Text style={styles.showButtonText}>{s.railTickets.showTicket}</Text>
            </SpringButton>

            <Pressable
              onPress={handleRemoveTicket}
              accessibilityRole="button"
              accessibilityLabel={s.railTickets.removeTicket}
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressedIconBtn]}
              hitSlop={8}
            >
              <Trash2 size={18} color={scheme.onSurfaceVariant} />
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ─── Stan 1: Brak dołączonego biletu (Kup w KOLEO + Dołącz PDF) ───────────
  const subText = summary.transferCount > 0
    ? s.railTickets.buyKoleoTransferSub(summary.fromStation, summary.toStation, summary.transferCount)
    : s.railTickets.buyKoleoSub(summary.fromStation, summary.toStation);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <SpringButton
          onPress={handleBuyKoleo}
          accessibilityLabel={`${s.railTickets.buyKoleo}. ${subText}`}
          style={styles.koleoButton}
        >
          <View style={styles.iconBadge}>
            <TrainFront size={20} color={scheme.onPrimaryContainer} />
          </View>
          <View style={styles.content}>
            <Text style={styles.title} numberOfLines={1}>
              {s.railTickets.buyKoleo}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {subText}
            </Text>
          </View>
          <ExternalLink size={18} color={scheme.onSurfaceVariant} style={styles.extIcon} />
        </SpringButton>

        <View style={styles.divider} />

        <SpringButton
          onPress={handleAttachPdf}
          accessibilityLabel={s.railTickets.attachPdf}
          style={styles.attachButton}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color={scheme.primary} />
          ) : (
            <FileUp size={20} color={scheme.primary} />
          )}
        </SpringButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 58,
    gap: 10,
  },
  koleoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: shape.medium,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    ...type.titleSmall,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  subtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    marginTop: 1,
  },
  extIcon: {
    marginRight: 4,
  },
  divider: {
    width: 1,
    height: 30,
    backgroundColor: scheme.outlineVariant,
  },
  attachButton: {
    width: 44,
    height: 44,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  showButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.full,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  showButtonText: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onPrimaryContainer,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedIconBtn: {
    backgroundColor: scheme.surfaceContainerHighest,
  },
  focusedRing: {
    borderWidth: 2,
    borderColor: scheme.primary,
  },
});
