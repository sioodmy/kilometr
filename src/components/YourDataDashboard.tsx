// Dashboard sekcji „Twoje dane" w Ustawieniach:
// bilans podrozy, wykres kolowy linii, kolej i srodki transportu, najczestsze cele,
// generator prywatnej grafiki na social media oraz kopia zapasowa.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useStrings } from '../i18n';
import { subscribeBackupApplied } from '../services/backupEvents';
import { loadUserDataStats, type UserDataStats } from '../services/userStats';
import type { LegMode } from '../types/models';
import { scheme, shape, type } from '../theme/tokens';
import { BackupCard } from './BackupCard';
import {
  BusFront,
  CableCar,
  ChevronRight,
  Clock3,
  Eco,
  Footprints,
  ImageUp,
  Layers,
  MapPin,
  ShieldCheck,
  Ticket,
  TrainFront,
  TramFront,
} from './icons';
import { LinesPieChart } from './LinesPieChart';
import { SpringPressable } from './SpringPressable';
import { WrappedShareSheet } from './WrappedShareSheet';

const MODE_COLORS: Record<LegMode, string> = {
  tram: '#71D8C2',
  bus: '#96CCFF',
  train: '#FFB957',
  subway: '#CBBEFF',
  trolleybus: '#97D77D',
  cable: '#FFB1C5',
  walk: '#BFC9C5',
};

function ModeGlyph({ mode, color, size = 18 }: { mode: LegMode; color: string; size?: number }) {
  if (mode === 'tram') return <TramFront size={size} color={color} />;
  if (mode === 'train' || mode === 'subway') return <TrainFront size={size} color={color} />;
  if (mode === 'cable') return <CableCar size={size} color={color} />;
  if (mode === 'walk') return <Footprints size={size} color={color} />;
  return <BusFront size={size} color={color} />;
}

export function YourDataDashboard({ deferLoad = false }: { deferLoad?: boolean } = {}) {
  const s = useStrings();
  const y = s.yourData;
  const [stats, setStats] = useState<UserDataStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await loadUserDataStats();
      setStats(next);
    } catch (err) {
      console.warn('[YourDataDashboard] load failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (deferLoad) return;
    void refresh();
    return subscribeBackupApplied(() => {
      void refresh();
    });
  }, [deferLoad, refresh]);

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={scheme.primary} />
      </View>
    );
  }

  const hasData = Boolean(stats && stats.hasAnyData);

  return (
    <View style={styles.root}>
      {/* Karta glowna: przejechane km, kursy, czas, miasta + przycisk karty na social media */}
      {hasData && stats ? (
        <>
          <View style={styles.heroCard}>
            <Svg
              style={styles.heroTrackBg}
              width="190"
              height="140"
              viewBox="0 0 190 140"
              pointerEvents="none"
            >
              <Path
                d="M 24 -8 C 44 48, 96 64, 198 72"
                stroke={scheme.primaryContainer}
                strokeWidth={2.5}
                fill="none"
                strokeLinecap="round"
              />
              <Path
                d="M 56 -8 C 76 58, 118 92, 198 110"
                stroke={scheme.outlineVariant}
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
              />
              <Circle
                cx="66"
                cy="42"
                r="4.5"
                fill={scheme.surfaceContainerLow}
                stroke={scheme.primary}
                strokeWidth="2.2"
              />
              <Circle
                cx="126"
                cy="64"
                r="4.5"
                fill={scheme.surfaceContainerLow}
                stroke={scheme.primary}
                strokeWidth="2.2"
              />
            </Svg>

            <View style={styles.heroTop}>
              <Text style={styles.heroLabel}>{y.distanceLabel}</Text>
              <Text
                style={styles.heroDistance}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {y.formatKm(stats.totalDistanceKm)}
              </Text>
              <View style={styles.archetypeBadge}>
                <Text style={styles.archetypeText}>{y.archetypes[stats.archetype]}</Text>
              </View>
            </View>

            <View style={styles.kpiRow}>
              <View style={styles.kpiTile}>
                <Text style={styles.kpiValue}>{stats.totalTrips}</Text>
                <Text style={styles.kpiLabel}>{y.tripsLabel}</Text>
              </View>
              <View style={[styles.kpiTile, styles.kpiTileWide]}>
                <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit>
                  {y.formatDuration(stats.totalDurationMin)}
                </Text>
                <Text style={styles.kpiLabel}>{y.timeLabel}</Text>
              </View>
              <View style={styles.kpiTile}>
                <Text style={styles.kpiValue}>{Math.max(1, stats.citiesCount)}</Text>
                <Text style={styles.kpiLabel}>{y.citiesLabel}</Text>
              </View>
            </View>

            <SpringPressable
              onPress={() => setShareOpen(true)}
              haptic="light"
              accessibilityRole="button"
              accessibilityLabel={y.shareCardCta}
              style={styles.shareCta}
            >
              <View style={styles.shareCtaIcon}>
                <ImageUp size={20} color={scheme.onPrimary} />
              </View>
              <View style={styles.shareCtaText}>
                <Text style={styles.shareCtaTitle}>{y.shareCardCta}</Text>
                <Text style={styles.shareCtaSub}>{y.shareCardSub}</Text>
              </View>
              <ChevronRight size={18} color={scheme.onPrimaryContainer} />
            </SpringPressable>
          </View>

          {/* Wykres kolowy najczestszych linii */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.sectionTitle} accessibilityRole="header">
                {y.topLinesTitle}
              </Text>
              {stats.hasDetailedLines ? (
                <Text style={styles.sectionSubtitle}>{y.topLinesSubtitle}</Text>
              ) : null}
            </View>
            {stats.hasDetailedLines ? (
              <LinesPieChart
                lines={stats.topLines}
                totalOccurrences={stats.totalLineOccurrences}
              />
            ) : (
              <Text style={styles.emptyCardText}>{y.topLinesEmpty}</Text>
            )}
          </View>

          {/* Kolej i srodki transportu */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {y.railSectionTitle}
            </Text>

            {stats.modes.length > 0 ? (
              <>
                <View style={styles.modeBarTrack}>
                  {stats.modes.map((m) => (
                    <View
                      key={m.mode}
                      style={[
                        styles.modeBarSegment,
                        {
                          flex: Math.max(0.06, m.share),
                          backgroundColor: MODE_COLORS[m.mode] ?? scheme.primary,
                        },
                      ]}
                    />
                  ))}
                </View>

                <View style={styles.modesList}>
                  {stats.modes.map((m) => {
                    const color = MODE_COLORS[m.mode] ?? scheme.primary;
                    const pct = Math.max(1, Math.round(m.share * 100));
                    return (
                      <View key={m.mode} style={styles.modeRow}>
                        <View style={[styles.modeIconWrap, { backgroundColor: `${color}22` }]}>
                          <ModeGlyph mode={m.mode} color={color} size={18} />
                        </View>
                        <View style={styles.modeTextCol}>
                          <Text style={styles.modeName}>{y.modes[m.mode]}</Text>
                          <Text style={styles.modeMeta}>
                            {m.distanceKm > 0
                              ? `${y.formatKm(m.distanceKm)} · ${y.lineTrips(m.trips)}`
                              : y.lineTrips(m.trips)}
                          </Text>
                        </View>
                        <Text style={styles.modePct}>{pct}%</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            ) : null}

            {/* Dedykowany boks kolejowy */}
            <View style={styles.railHighlight}>
              <View style={styles.railIconBox}>
                <TrainFront size={20} color="#FFB957" />
              </View>
              <View style={styles.railBody}>
                <Text style={styles.railHeading}>{y.railTitle}</Text>
                {stats.rail.trips > 0 ? (
                  <Text style={styles.railStatsText}>
                    {stats.rail.distanceKm > 0
                      ? `${y.railTrips(stats.rail.trips)} · ${y.formatKm(stats.rail.distanceKm)}`
                      : y.railTrips(stats.rail.trips)}
                    {stats.rail.durationMin > 0
                      ? ` · ${y.formatDuration(stats.rail.durationMin)}`
                      : ''}
                  </Text>
                ) : (
                  <Text style={styles.railEmptyText}>{y.railEmpty}</Text>
                )}
              </View>
              {stats.rail.ticketsCount > 0 ? (
                <View style={styles.ticketBadge}>
                  <Ticket size={14} color={scheme.onTertiaryContainer} />
                  <Text style={styles.ticketBadgeText}>
                    {y.railTickets(stats.rail.ticketsCount)}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Dodatkowe metryki: pieszo, przystanki, CO2 */}
            <View style={styles.extraGrid}>
              <View style={styles.extraTile}>
                <Footprints size={16} color={scheme.primary} />
                <Text style={styles.extraValue}>{y.formatKm(stats.totalWalkKm)}</Text>
                <Text style={styles.extraLabel}>{y.walkLabel}</Text>
              </View>
              <View style={styles.extraTile}>
                <Layers size={16} color={scheme.tertiary} />
                <Text style={styles.extraValue}>{stats.totalStops}</Text>
                <Text style={styles.extraLabel}>{y.stopsLabel}</Text>
              </View>
              <View style={styles.extraTile}>
                <Eco size={16} color={scheme.success} />
                <Text style={styles.extraValue}>{y.formatCo2(stats.estimatedCo2SavedKg)}</Text>
                <Text style={styles.extraLabel} numberOfLines={1}>
                  {y.co2Label}
                </Text>
              </View>
            </View>
          </View>

          {/* Najczestsze cele podrozy (tylko lokalnie w dashboardzie) */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {y.topDestinationsTitle}
            </Text>

            {stats.topDestinations.length > 0 ? (
              <View style={styles.destList}>
                {stats.topDestinations.map((dest, idx) => {
                  const isFirst = idx === 0;
                  const maxCount = stats.topDestinations[0]?.count || 1;
                  const barPct = Math.max(10, Math.round((dest.count / maxCount) * 100));
                  return (
                    <View
                      key={dest.key}
                      style={[styles.destItem, isFirst && styles.destItemLead]}
                    >
                      <View style={styles.destRow}>
                        <View style={[styles.destRank, isFirst && styles.destRankLead]}>
                          {isFirst ? (
                            <MapPin size={16} color={scheme.onPrimary} />
                          ) : (
                            <Text style={styles.destRankNum}>{idx + 1}</Text>
                          )}
                        </View>
                        <View style={styles.destInfo}>
                          <Text style={styles.destTitle} numberOfLines={1}>
                            {dest.title}
                          </Text>
                          {dest.address ? (
                            <Text style={styles.destAddress} numberOfLines={1}>
                              {dest.address}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.destRight}>
                          <Text style={styles.destCount}>{y.lineTrips(dest.count)}</Text>
                          {dest.avgDurationMin > 0 ? (
                            <View style={styles.destTimeRow}>
                              <Clock3 size={11} color={scheme.onSurfaceVariant} />
                              <Text style={styles.destTime}>
                                {y.avgTime(dest.avgDurationMin)}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <View style={styles.destBarTrack}>
                        <View
                          style={[
                            styles.destBarFill,
                            isFirst && styles.destBarFillLead,
                            { width: `${barPct}%` },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.emptyCardText}>{y.topDestinationsEmpty}</Text>
            )}
          </View>
        </>
      ) : (
        <View style={styles.emptyHero}>
          <View style={styles.emptyIconCircle}>
            <TramFront size={28} color={scheme.primary} />
          </View>
          <Text style={styles.emptyTitle}>{y.emptyTitle}</Text>
          <Text style={styles.emptyBody}>{y.emptyBody}</Text>
        </View>
      )}

      {/* Sekcja kopii zapasowej (import / eksport JSON) */}
      <BackupCard onDataChanged={() => void refresh()} />

      <View style={styles.localNoteRow}>
        <ShieldCheck size={15} color={scheme.onSurfaceVariant} />
        <Text style={styles.localNoteText}>{y.localOnlyNote}</Text>
      </View>

      {stats ? (
        <WrappedShareSheet
          visible={shareOpen}
          summary={stats.wrapped}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 14,
  },
  loadingBox: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCard: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 20,
    gap: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  heroTrackBg: {
    position: 'absolute',
    top: 0,
    right: 0,
    opacity: 0.9,
  },
  heroTop: {
    gap: 4,
  },
  heroLabel: {
    ...type.labelLarge,
    color: scheme.onSurfaceVariant,
  },
  heroDistance: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '800',
    color: scheme.onSurface,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  archetypeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: scheme.primaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: shape.full,
    marginTop: 4,
  },
  archetypeText: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onPrimaryContainer,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 10,
  },
  kpiTile: {
    flex: 1,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    paddingVertical: 12,
    paddingHorizontal: 11,
    gap: 3,
  },
  kpiTileWide: {
    flex: 1.55,
  },
  kpiValue: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  kpiLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  shareCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.primaryContainer,
    borderRadius: shape.large,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 58,
  },
  shareCtaIcon: {
    width: 38,
    height: 38,
    borderRadius: shape.medium,
    backgroundColor: scheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareCtaText: {
    flex: 1,
    gap: 2,
  },
  shareCtaTitle: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  shareCtaSub: {
    ...type.bodySmall,
    color: scheme.onPrimaryContainer,
    opacity: 0.85,
  },
  card: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 20,
    gap: 14,
  },
  cardHead: {
    gap: 3,
  },
  sectionTitle: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  sectionSubtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  emptyCardText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  modeBarTrack: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 3,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  modeBarSegment: {
    height: 12,
    borderRadius: 6,
  },
  modesList: {
    gap: 8,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  modeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTextCol: {
    flex: 1,
    gap: 1,
  },
  modeName: {
    ...type.titleSmall,
    color: scheme.onSurface,
  },
  modeMeta: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  modePct: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  railHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 14,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  railIconBox: {
    width: 40,
    height: 40,
    borderRadius: shape.medium,
    backgroundColor: '#FFB95724',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railBody: {
    flex: 1,
    gap: 2,
  },
  railHeading: {
    ...type.titleSmall,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  railStatsText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  railEmptyText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  ticketBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.tertiaryContainer,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  ticketBadgeText: {
    ...type.labelSmall,
    fontWeight: '600',
    color: scheme.onTertiaryContainer,
  },
  extraGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  extraTile: {
    flex: 1,
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'flex-start',
    gap: 4,
  },
  extraValue: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  extraLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  destList: {
    gap: 10,
  },
  destItem: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.large,
    padding: 13,
    gap: 10,
  },
  destItemLead: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  destRank: {
    width: 30,
    height: 30,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destRankLead: {
    backgroundColor: scheme.primary,
  },
  destRankNum: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
  },
  destInfo: {
    flex: 1,
    gap: 1,
  },
  destTitle: {
    ...type.titleSmall,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  destAddress: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  destRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  destCount: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.primary,
    fontVariant: ['tabular-nums'],
  },
  destTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  destTime: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  destBarTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: scheme.surfaceContainerHighest,
    overflow: 'hidden',
  },
  destBarFill: {
    height: 5,
    borderRadius: 3,
    backgroundColor: scheme.secondary,
  },
  destBarFillLead: {
    backgroundColor: scheme.primary,
  },
  emptyHero: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.extraLarge,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  emptyBody: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 21,
  },
  localNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  localNoteText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
  },
});
