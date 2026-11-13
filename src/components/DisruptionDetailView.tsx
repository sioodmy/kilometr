import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ArrowRight,
  BusFront,
  CircleCheck,
  CircleX,
  Clock3,
  MapPin,
  MapPinOff,
  RouteOff,
  Ticket,
  TriangleAlert,
} from './icons';
import { LineBadge } from './LineBadge';
import { scheme, shape, type } from '../theme/tokens';
import { useStrings, type Strings } from '../i18n';
import {
  groundDisruption,
  type GroundedDisruption,
} from '../services/disruptionGrounding';
import type {
  DisruptionAlert,
  DisruptionHours,
  DisruptionStop,
  LineChange,
  TemporaryLine,
} from '../services/mpkNews';

interface NormalizedLineChange {
  line: string;
  direction: string | null;
  change: LineChange['change'];
  from_stop: string | null;
  to_stop: string | null;
  via: string[];
  omitted_stops: string[];
  temporary_stops: string[];
  transfer_stops: string[];
  replacement_line: string | null;
  hours: DisruptionHours[];
  details: string;
}

function mapLegacyImpactType(raw: string): LineChange['change'] {
  const lower = raw.toLowerCase();
  if (lower.includes('cancel') || lower.includes('suspend')) return 'cancelled';
  if (lower.includes('detour') || lower.includes('diver')) return 'detour';
  if (lower.includes('short')) return 'shortened';
  if (lower.includes('skip') || lower.includes('omit')) return 'stops_skipped';
  if (lower.includes('freq')) return 'frequency_change';
  if (lower.includes('sched') || lower.includes('time')) return 'schedule_change';
  if (lower.includes('restor')) return 'route_restored';
  return 'other';
}

function normalizeLineChanges(alert: DisruptionAlert): NormalizedLineChange[] {
  if (alert.line_changes && alert.line_changes.length > 0) {
    return alert.line_changes.map((lc) => ({
      line: lc.line,
      direction: lc.direction ?? null,
      change: lc.change,
      from_stop: lc.from_stop ?? null,
      to_stop: lc.to_stop ?? null,
      via: lc.via ?? [],
      omitted_stops: lc.omitted_stops ?? [],
      temporary_stops: lc.temporary_stops ?? [],
      transfer_stops: lc.transfer_stops ?? [],
      replacement_line: lc.replacement_line ?? null,
      hours: lc.hours ?? [],
      details: lc.details ?? '',
    }));
  }

  return (alert.impacted_lines ?? []).map((imp) => ({
    line: imp.line,
    direction: imp.direction ?? null,
    change: mapLegacyImpactType(imp.impact_type || ''),
    from_stop: null,
    to_stop: null,
    via: [],
    omitted_stops: imp.omitted_stops ?? [],
    temporary_stops: imp.temporary_stops ?? [],
    transfer_stops: [],
    replacement_line: imp.replacement_line ?? null,
    hours: [],
    details: imp.details ?? '',
  }));
}

function formatHoursList(hours: DisruptionHours[]): string {
  if (!hours || hours.length === 0) return '';
  return hours
    .filter((h) => h.from && h.to)
    .map((h) => `${h.from} - ${h.to}`)
    .join(', ');
}

function getDisruptionTypeLabel(
  disruptionType: DisruptionAlert['disruption_type'],
  d: Strings['news']['detail'],
): string {
  switch (disruptionType) {
    case 'accident':
      return d.typeAccident;
    case 'infrastructure_failure':
      return d.typeInfra;
    case 'planned_works':
      return d.typeWorks;
    case 'event':
      return d.typeEvent;
    case 'weather':
      return d.typeWeather;
    case 'fare':
      return d.typeFare;
    default:
      return d.typeOther;
  }
}

function getChangeBadgeSpec(
  change: LineChange['change'],
  d: Strings['news']['detail'],
): { label: string; bg: string; fg: string } {
  switch (change) {
    case 'cancelled':
      return {
        label: d.changeCancelled,
        bg: scheme.errorContainer,
        fg: scheme.onErrorContainer,
      };
    case 'detour':
      return {
        label: d.changeDetour,
        bg: scheme.warningContainer,
        fg: scheme.onWarningContainer,
      };
    case 'shortened':
      return {
        label: d.changeShortened,
        bg: scheme.tertiaryContainer,
        fg: scheme.onTertiaryContainer,
      };
    case 'stops_skipped':
      return {
        label: d.changeSkipped,
        bg: scheme.warningContainer,
        fg: scheme.onWarningContainer,
      };
    case 'schedule_change':
      return {
        label: d.changeSchedule,
        bg: scheme.secondaryContainer,
        fg: scheme.onSecondaryContainer,
      };
    case 'frequency_change':
      return {
        label: d.changeFrequency,
        bg: scheme.secondaryContainer,
        fg: scheme.onSecondaryContainer,
      };
    case 'route_restored':
      return {
        label: d.changeRestored,
        bg: scheme.successContainer,
        fg: scheme.onSuccessContainer,
      };
    default:
      return {
        label: d.changeOther,
        bg: scheme.surfaceContainerHighest,
        fg: scheme.onSurfaceVariant,
      };
  }
}

function getStopActionLabel(
  stop: DisruptionStop,
  canonical: Map<string, string>,
  d: Strings['news']['detail'],
): { label: string; bg: string; fg: string; muted: boolean } {
  const act = (stop.action || '').toLowerCase();
  if (act === 'replaced_by' && stop.replaced_by) {
    const target = canonical.get(stop.replaced_by) ?? stop.replaced_by;
    return {
      label: d.stopReplacedBy(target),
      bg: scheme.primaryContainer,
      fg: scheme.onPrimaryContainer,
      muted: false,
    };
  }
  if (act === 'omitted') {
    return {
      label: d.stopOmitted,
      bg: scheme.errorContainer,
      fg: scheme.onErrorContainer,
      muted: true,
    };
  }
  if (act === 'relocated') {
    return {
      label: d.stopRelocated,
      bg: scheme.warningContainer,
      fg: scheme.onWarningContainer,
      muted: false,
    };
  }
  if (act === 'temporary') {
    return {
      label: d.stopTemporary,
      bg: scheme.tertiaryContainer,
      fg: scheme.onTertiaryContainer,
      muted: false,
    };
  }
  if (act === 'board_opposite') {
    return {
      label: d.stopOpposite,
      bg: scheme.secondaryContainer,
      fg: scheme.onSecondaryContainer,
      muted: false,
    };
  }
  if (act === 'restored') {
    return {
      label: d.stopRestored,
      bg: scheme.successContainer,
      fg: scheme.onSuccessContainer,
      muted: false,
    };
  }
  return {
    label: d.changeOther,
    bg: scheme.surfaceContainerHighest,
    fg: scheme.onSurfaceVariant,
    muted: false,
  };
}

/** Klikalna odznaka linii, jeśli linia istnieje w lokalnej bazie GTFS (nawigacja do rozkładu). */
const InteractiveLineChip = memo(function InteractiveLineChip({
  line,
  routeId,
  onOpenRoute,
}: {
  line: string;
  routeId?: string;
  onOpenRoute: (routeId: string) => void;
}) {
  const s = useStrings();
  if (!routeId) {
    return <LineBadge line={line} />;
  }
  return (
    <Pressable
      onPress={() => onOpenRoute(routeId)}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={s.news.detail.openLineTimetableA11y(line)}
      style={({ pressed }) => [
        styles.tappableLineWrap,
        pressed && { opacity: 0.8, transform: [{ scale: 0.96 }] },
      ]}
    >
      <LineBadge line={line} />
    </Pressable>
  );
});

interface TrackNode {
  key: string;
  name: string;
  kind: 'anchor' | 'omitted' | 'detour' | 'temporary' | 'transfer';
  sublabel?: string;
}

/**
 * Graficzny schemat przebiegu pojedynczej linii objętej utrudnieniem.
 * Pokazuje stałe punkty wejścia/wyjścia (anchor), wycięte przystanki (omitted)
 * oraz aktywny ciąg objazdu (detour / temporary / transfer) na pionowej szynie.
 */
const LineSchematicCard = memo(function LineSchematicCard({
  item,
  canonical,
  routeId,
  onOpenRoute,
}: {
  item: NormalizedLineChange;
  canonical: Map<string, string>;
  routeId?: string;
  onOpenRoute: (routeId: string) => void;
}) {
  const s = useStrings();
  const d = s.news.detail;
  const badge = getChangeBadgeSpec(item.change, d);
  const hoursText = formatHoursList(item.hours);
  const canon = (raw: string | null) => (raw ? canonical.get(raw) ?? raw : null);

  const transferSet = useMemo(
    () => new Set(item.transfer_stops.map((n) => canon(n) ?? n)),
    [item.transfer_stops, canonical],
  );
  const tempSet = useMemo(
    () => new Set(item.temporary_stops.map((n) => canon(n) ?? n)),
    [item.temporary_stops, canonical],
  );

  const nodes = useMemo<TrackNode[]>(() => {
    const out: TrackNode[] = [];
    const seenInActive = new Set<string>();

    const fromName = canon(item.from_stop);
    const toName = canon(item.to_stop);

    const activeStops: string[] = [];
    for (const v of item.via) {
      const name = canon(v) ?? v;
      if (name && !seenInActive.has(name)) {
        seenInActive.add(name);
        activeStops.push(name);
      }
    }
    if (activeStops.length === 0) {
      for (const ts of item.temporary_stops) {
        const name = canon(ts) ?? ts;
        if (name && !seenInActive.has(name)) {
          seenInActive.add(name);
          activeStops.push(name);
        }
      }
    }

    const omitted = item.omitted_stops
      .map((st) => canon(st) ?? st)
      .filter((st): st is string => Boolean(st && st !== fromName && st !== toName));

    if (fromName && activeStops[0] !== fromName) {
      out.push({
        key: `from:${fromName}`,
        name: fromName,
        kind: transferSet.has(fromName) ? 'transfer' : 'anchor',
        sublabel: transferSet.has(fromName) ? d.transferAtLabel : undefined,
      });
    }

    for (const om of omitted) {
      out.push({
        key: `om:${om}`,
        name: om,
        kind: 'omitted',
        sublabel: d.omittedLabel,
      });
    }

    for (const act of activeStops) {
      const isTransfer = transferSet.has(act);
      const isTemp = tempSet.has(act);
      out.push({
        key: `act:${act}`,
        name: act,
        kind: isTransfer ? 'transfer' : isTemp ? 'temporary' : 'detour',
        sublabel: isTransfer
          ? d.transferAtLabel
          : isTemp
            ? d.temporaryStopsLabel
            : undefined,
      });
    }

    if (toName && activeStops[activeStops.length - 1] !== toName && toName !== fromName) {
      out.push({
        key: `to:${toName}`,
        name: toName,
        kind: transferSet.has(toName) ? 'transfer' : 'anchor',
        sublabel: transferSet.has(toName) ? d.transferAtLabel : undefined,
      });
    }

    return out;
  }, [item, canonical, transferSet, tempSet, d]);

  const directionLabel =
    item.direction && item.direction.trim()
      ? d.directionPrefix(canon(item.direction) ?? item.direction)
      : null;

  const replacementClean = item.replacement_line?.trim() || null;
  const replacementShortToken =
    replacementClean && /^[A-Z0-9-]{1,6}$/i.test(replacementClean) ? replacementClean : null;

  return (
    <View style={styles.lineCard}>
      <View style={styles.lineCardHeader}>
        <View style={styles.lineIdentity}>
          <InteractiveLineChip line={item.line} routeId={routeId} onOpenRoute={onOpenRoute} />
          <View style={styles.lineIdentityMeta}>
            {directionLabel ? (
              <Text style={styles.lineDirection} numberOfLines={2}>
                {directionLabel}
              </Text>
            ) : null}
            {hoursText ? (
              <View style={styles.hoursInline}>
                <Clock3 size={12} color={scheme.onSurfaceVariant} />
                <Text style={styles.hoursInlineText}>{hoursText}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={[styles.changePill, { backgroundColor: badge.bg }]}>
          {item.change === 'cancelled' ? (
            <RouteOff size={13} color={badge.fg} />
          ) : null}
          <Text style={[styles.changePillText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
      </View>

      {nodes.length > 0 ? (
        <View style={styles.schematicWrap}>
          {nodes.map((node, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === nodes.length - 1;
            const prev = idx > 0 ? nodes[idx - 1] : null;
            const isOmitted = node.kind === 'omitted';
            const upperMuted = prev?.kind === 'omitted' || isOmitted;
            const lowerMuted = isOmitted || nodes[idx + 1]?.kind === 'omitted';

            return (
              <View key={node.key} style={styles.trackRow}>
                <View style={styles.trackRailCol}>
                  {!isFirst ? (
                    <View
                      style={[
                        styles.railSegmentUpper,
                        {
                          backgroundColor: upperMuted
                            ? scheme.outlineVariant
                            : scheme.primary,
                        },
                      ]}
                    />
                  ) : null}
                  {!isLast ? (
                    <View
                      style={[
                        styles.railSegmentLower,
                        {
                          backgroundColor: lowerMuted
                            ? scheme.outlineVariant
                            : scheme.primary,
                        },
                      ]}
                    />
                  ) : null}

                  {isOmitted ? (
                    <View style={styles.nodeOmittedWrap}>
                      <CircleX size={14} color={scheme.error} />
                    </View>
                  ) : node.kind === 'transfer' ? (
                    <View style={styles.nodeTransferOuter}>
                      <View style={styles.nodeTransferInner} />
                    </View>
                  ) : node.kind === 'anchor' ? (
                    <View style={styles.nodeAnchor} />
                  ) : (
                    <View
                      style={[
                        styles.nodeDetour,
                        node.kind === 'temporary' && { backgroundColor: scheme.tertiary },
                      ]}
                    />
                  )}
                </View>

                <View style={styles.trackTextCol}>
                  <Text
                    style={[
                      styles.trackStopName,
                      isOmitted && styles.trackStopOmitted,
                      (node.kind === 'anchor' || node.kind === 'transfer') &&
                        styles.trackStopStrong,
                    ]}
                  >
                    {node.name}
                  </Text>
                  {node.sublabel ? (
                    <Text
                      style={[
                        styles.trackSublabel,
                        isOmitted && { color: scheme.error },
                        node.kind === 'transfer' && { color: scheme.primary },
                      ]}
                    >
                      {node.sublabel}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {replacementClean ? (
        <View style={styles.replacementBanner}>
          <BusFront size={15} color={scheme.primary} />
          <Text style={styles.replacementLabel}>{d.replacementLabel}:</Text>
          {replacementShortToken ? (
            <LineBadge line={replacementShortToken} compact />
          ) : (
            <Text style={styles.replacementValue}>{replacementClean}</Text>
          )}
        </View>
      ) : null}

      {item.details ? <Text style={styles.lineDetailsText}>{item.details}</Text> : null}
    </View>
  );
});

const TempLineCard = memo(function TempLineCard({
  item,
  canonical,
}: {
  item: TemporaryLine;
  canonical: Map<string, string>;
}) {
  const s = useStrings();
  const d = s.news.detail;
  const hoursText = formatHoursList(item.hours ?? []);
  const viaStops = (item.via ?? []).map((st) => canonical.get(st) ?? st).filter(Boolean);

  return (
    <View style={styles.tempCard}>
      <View style={styles.lineCardHeader}>
        <View style={styles.lineIdentity}>
          <LineBadge line={item.line} />
          <View style={styles.lineIdentityMeta}>
            {item.serves && item.serves.length > 0 ? (
              <Text style={styles.lineDirection}>
                {d.servesLines(item.serves.join(', '))}
              </Text>
            ) : null}
            {hoursText ? (
              <View style={styles.hoursInline}>
                <Clock3 size={12} color={scheme.onSurfaceVariant} />
                <Text style={styles.hoursInlineText}>{hoursText}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {item.frequency_min ? (
          <View style={[styles.changePill, { backgroundColor: scheme.primaryContainer }]}>
            <Text style={[styles.changePillText, { color: scheme.onPrimaryContainer }]}>
              {s.news.everyNMin(item.frequency_min)}
            </Text>
          </View>
        ) : null}
      </View>

      {viaStops.length > 0 ? (
        <View style={styles.viaFlowRow}>
          {viaStops.map((stopName, idx) => (
            <View key={`${stopName}:${idx}`} style={styles.viaFlowItem}>
              {idx > 0 ? (
                <ArrowRight size={13} color={scheme.primary} style={styles.viaArrow} />
              ) : null}
              <Text
                style={[
                  styles.viaStopChip,
                  (idx === 0 || idx === viaStops.length - 1) && styles.viaStopEndpoint,
                ]}
              >
                {stopName}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {item.details ? <Text style={styles.lineDetailsText}>{item.details}</Text> : null}
    </View>
  );
});

export const DisruptionDetailView = memo(function DisruptionDetailView({
  alert,
  fallbackTitle,
  fallbackMeta,
  fallbackLines,
}: {
  alert: DisruptionAlert;
  fallbackTitle?: string;
  fallbackMeta?: string;
  fallbackLines?: string[];
}) {
  const s = useStrings();
  const d = s.news.detail;
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [grounded, setGrounded] = useState<GroundedDisruption | null>(null);

  useEffect(() => {
    let alive = true;
    void groundDisruption(alert).then((res) => {
      if (alive) setGrounded(res);
    });
    return () => {
      alive = false;
    };
  }, [alert]);

  const canonicalStops = useMemo(() => {
    const map = new Map<string, string>();
    for (const st of grounded?.stops ?? []) {
      map.set(st.raw, st.name);
    }
    return map;
  }, [grounded]);

  const routeIdByLine = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of grounded?.lines ?? []) {
      if (l.route_ids[0]) {
        map.set(l.line.trim().toUpperCase(), l.route_ids[0]);
      }
    }
    return map;
  }, [grounded]);

  const openRouteTimetable = (routeId: string) => {
    void Haptics.selectionAsync().catch(() => {});
    router.push({ pathname: '/line', params: { routeId } });
  };

  const allLines = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (val?: string | null) => {
      if (!val) return;
      const clean = String(val).trim().toUpperCase();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push(clean);
    };
    for (const l of alert.all_lines ?? []) add(l);
    for (const lc of alert.line_changes ?? []) add(lc.line);
    for (const tl of alert.temporary_lines ?? []) add(tl.line);
    for (const imp of alert.impacted_lines ?? []) add(imp.line);
    for (const l of fallbackLines ?? []) add(l);
    return out;
  }, [alert, fallbackLines]);

  const lineChanges = useMemo(() => normalizeLineChanges(alert), [alert]);
  const tempLines = alert.temporary_lines ?? [];
  const stops = alert.stops ?? [];
  const phases = alert.phases ?? [];

  const isResolved = Boolean(alert.is_resolved);
  const isBlocking = !isResolved && alert.severity === 'blocking';
  const isUrgent = !isResolved && (alert.is_emergency || alert.severity === 'major' || isBlocking);

  const statusChipSpec = isResolved
    ? {
        label: s.news.resolved,
        bg: scheme.successContainer,
        fg: scheme.onSuccessContainer,
        kind: 'resolved' as const,
      }
    : isBlocking
      ? {
          label: d.severityBlocking,
          bg: scheme.errorContainer,
          fg: scheme.onErrorContainer,
          kind: 'urgent' as const,
        }
      : isUrgent
        ? {
            label: alert.severity === 'major' ? d.severityMajor : s.news.urgentChip,
            bg: scheme.warningContainer,
            fg: scheme.onWarningContainer,
            kind: 'urgent' as const,
          }
        : {
            label: alert.severity === 'minor' ? d.severityMinor : s.news.plannedChip,
            bg: scheme.secondaryContainer,
            fg: scheme.onSecondaryContainer,
            kind: 'planned' as const,
          };

  const typeLabel = getDisruptionTypeLabel(alert.disruption_type, d);
  const timeframe = alert.glance?.timeframe || fallbackMeta || '';
  const headline = alert.headline || fallbackTitle || alert.source_title;
  const problem = alert.glance?.problem;
  const solution = alert.glance?.solution;

  const corridorFrom = alert.corridor?.from_stop
    ? canonicalStops.get(alert.corridor.from_stop) ?? alert.corridor.from_stop
    : null;
  const corridorTo = alert.corridor?.to_stop
    ? canonicalStops.get(alert.corridor.to_stop) ?? alert.corridor.to_stop
    : null;

  return (
    <View style={styles.root}>
      {/* 1. Nagłówek operacyjny: status, kategoria, czas i linie */}
      <Animated.View
        entering={reduceMotion ? undefined : FadeInDown.duration(200)}
        style={styles.heroSection}
      >
        <View style={styles.statusRow}>
          <View style={[styles.statusPill, { backgroundColor: statusChipSpec.bg }]}>
            {statusChipSpec.kind === 'resolved' ? (
              <CircleCheck size={14} color={statusChipSpec.fg} />
            ) : statusChipSpec.kind === 'urgent' ? (
              <TriangleAlert size={14} color={statusChipSpec.fg} />
            ) : (
              <Clock3 size={14} color={statusChipSpec.fg} />
            )}
            <Text style={[styles.statusPillText, { color: statusChipSpec.fg }]}>
              {statusChipSpec.label}
            </Text>
          </View>

          <View style={styles.typePill}>
            <Text style={styles.typePillText}>{typeLabel}</Text>
          </View>
        </View>

        <Text style={styles.headline} accessibilityRole="header">
          {headline}
        </Text>

        {timeframe ? (
          <View style={styles.timeframeRow}>
            <Clock3 size={15} color={scheme.onSurfaceVariant} />
            <Text style={styles.timeframeText}>{timeframe}</Text>
          </View>
        ) : null}

        {allLines.length > 0 ? (
          <View style={styles.heroLinesRow}>
            {allLines.map((line) => (
              <InteractiveLineChip
                key={line}
                line={line}
                routeId={routeIdByLine.get(line)}
                onOpenRoute={openRouteTimetable}
              />
            ))}
          </View>
        ) : null}
      </Animated.View>

      {/* 2. Korytarz, diagnoza problemu, objazd i honorowanie biletów */}
      <Animated.View
        entering={reduceMotion ? undefined : FadeInDown.delay(40).duration(220)}
        style={styles.overviewSection}
      >
        {alert.corridor?.label ? (
          <View style={styles.corridorBar}>
            <View style={styles.corridorIconWrap}>
              <MapPin size={18} color={scheme.onSecondaryContainer} />
            </View>
            <View style={styles.corridorTextCol}>
              <Text style={styles.corridorLabel}>{d.corridorLabel}</Text>
              <Text style={styles.corridorTitle}>{alert.corridor.label}</Text>
              {corridorFrom && corridorTo ? (
                <View style={styles.corridorEndpoints}>
                  <Text style={styles.corridorEndpointText}>{corridorFrom}</Text>
                  <ArrowRight size={13} color={scheme.onSurfaceVariant} />
                  <Text style={styles.corridorEndpointText}>{corridorTo}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {problem && problem.trim() !== headline.trim() ? (
          <Text style={styles.problemBody}>{problem}</Text>
        ) : null}

        {solution ? (
          <View
            style={[
              styles.actionPanel,
              isUrgent ? styles.actionPanelUrgent : styles.actionPanelStandard,
            ]}
          >
            <View style={styles.actionPanelHead}>
              <BusFront
                size={16}
                color={isUrgent ? scheme.onWarningContainer : scheme.onPrimaryContainer}
              />
              <Text
                style={[
                  styles.actionPanelLabel,
                  {
                    color: isUrgent
                      ? scheme.onWarningContainer
                      : scheme.onPrimaryContainer,
                  },
                ]}
              >
                {d.howToTravel}
              </Text>
            </View>
            <Text
              style={[
                styles.actionPanelText,
                {
                  color: isUrgent ? scheme.onWarningContainer : scheme.onPrimaryContainer,
                },
              ]}
            >
              {solution}
            </Text>
          </View>
        ) : null}

        {alert.ticket_honoring?.active && alert.ticket_honoring.summary ? (
          <View style={styles.ticketPanel}>
            <View style={styles.actionPanelHead}>
              <Ticket size={16} color={scheme.onTertiaryContainer} />
              <Text style={[styles.actionPanelLabel, { color: scheme.onTertiaryContainer }]}>
                {d.ticketHonoring}
              </Text>
            </View>
            <Text style={[styles.actionPanelText, { color: scheme.onTertiaryContainer }]}>
              {alert.ticket_honoring.summary}
            </Text>
          </View>
        ) : null}
      </Animated.View>

      {/* 3. Oś czasu etapów prac (tylko gdy komunikat ma wiele etapów) */}
      {phases.length > 0 ? (
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {d.phasesSection}
          </Text>
          <View style={styles.phasesTimeline}>
            {phases.map((phase, idx) => (
              <View key={`${phase.label}:${idx}`} style={styles.phaseRow}>
                <View style={styles.phaseRailCol}>
                  {idx < phases.length - 1 ? <View style={styles.phaseConnector} /> : null}
                  <View style={styles.phaseIndexBadge}>
                    <Text style={styles.phaseIndexText}>{idx + 1}</Text>
                  </View>
                </View>
                <View style={styles.phaseBody}>
                  <Text style={styles.phaseLabel}>{phase.label}</Text>
                  {phase.lines && phase.lines.length > 0 ? (
                    <View style={styles.inlineBadges}>
                      {phase.lines.map((l) => (
                        <LineBadge key={l} line={l} compact />
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.phaseSummary}>{phase.summary}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* 4. Schematy zmian per linia */}
      {lineChanges.length > 0 ? (
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {d.linesSection}
          </Text>
          <View style={styles.cardsStack}>
            {lineChanges.map((lc, idx) => (
              <LineSchematicCard
                key={`${lc.line}:${lc.direction ?? ''}:${idx}`}
                item={lc}
                canonical={canonicalStops}
                routeId={routeIdByLine.get(lc.line.trim().toUpperCase())}
                onOpenRoute={openRouteTimetable}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* 5. Linie tymczasowe i specjalne */}
      {tempLines.length > 0 ? (
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {d.tempLinesSection}
          </Text>
          <View style={styles.cardsStack}>
            {tempLines.map((tl, idx) => (
              <TempLineCard
                key={`${tl.line}:${idx}`}
                item={tl}
                canonical={canonicalStops}
              />
            ))}
          </View>
        </View>
      ) : null}

      {/* 6. Zestawienie zmienionych przystanków (zwarta lista z separatorami) */}
      {stops.length > 0 ? (
        <View style={styles.sectionBlock}>
          <Text style={styles.sectionHeading} accessibilityRole="header">
            {d.stopsSection}
          </Text>
          <View style={styles.stopsContainer}>
            {stops.map((st, idx) => {
              const canonName = canonicalStops.get(st.name) ?? st.name;
              const actSpec = getStopActionLabel(st, canonicalStops, d);
              return (
                <View
                  key={`${st.name}:${idx}`}
                  style={[styles.stopRow, idx > 0 && styles.stopRowDivider]}
                >
                  <View style={styles.stopTopRow}>
                    <View style={styles.stopNameGroup}>
                      {actSpec.muted ? (
                        <MapPinOff size={16} color={scheme.error} />
                      ) : (
                        <MapPin size={16} color={scheme.primary} />
                      )}
                      <Text
                        style={[
                          styles.stopNameText,
                          actSpec.muted && styles.trackStopOmitted,
                        ]}
                      >
                        {canonName}
                      </Text>
                    </View>
                    <View style={[styles.stopActionChip, { backgroundColor: actSpec.bg }]}>
                      <Text style={[styles.stopActionText, { color: actSpec.fg }]}>
                        {actSpec.label}
                      </Text>
                    </View>
                  </View>

                  {st.lines && st.lines.length > 0 ? (
                    <View style={styles.inlineBadges}>
                      {st.lines.map((l) => (
                        <LineBadge key={l} line={l} compact />
                      ))}
                    </View>
                  ) : null}

                  {st.details ? (
                    <Text style={styles.stopDetailsText}>{st.details}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    gap: 24,
  },
  heroSection: {
    gap: 12,
    paddingTop: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: shape.full,
  },
  statusPillText: {
    ...type.labelMedium,
    fontWeight: '700',
  },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
  },
  typePillText: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
  },
  headline: {
    ...type.headlineSmall,
    fontSize: 25,
    lineHeight: 32,
    fontWeight: '600',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  timeframeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  timeframeText: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  heroLinesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
  },
  tappableLineWrap: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  overviewSection: {
    gap: 14,
  },
  corridorBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    padding: 16,
  },
  corridorIconWrap: {
    width: 36,
    height: 36,
    borderRadius: shape.medium,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corridorTextCol: {
    flex: 1,
    gap: 3,
  },
  corridorLabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  corridorTitle: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  corridorEndpoints: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  corridorEndpointText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  problemBody: {
    ...type.bodyLarge,
    lineHeight: 24,
    color: scheme.onSurface,
  },
  actionPanel: {
    borderRadius: 20,
    padding: 16,
    gap: 6,
  },
  actionPanelStandard: {
    backgroundColor: scheme.primaryContainer,
  },
  actionPanelUrgent: {
    backgroundColor: scheme.warningContainer,
  },
  actionPanelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionPanelLabel: {
    ...type.labelLarge,
    fontWeight: '700',
  },
  actionPanelText: {
    ...type.bodyMedium,
    lineHeight: 21,
  },
  ticketPanel: {
    backgroundColor: scheme.tertiaryContainer,
    borderRadius: 20,
    padding: 16,
    gap: 6,
  },
  sectionBlock: {
    gap: 12,
  },
  sectionHeading: {
    ...type.titleMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  cardsStack: {
    gap: 12,
  },
  lineCard: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  tempCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  lineCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  lineIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  lineIdentityMeta: {
    flex: 1,
    gap: 3,
  },
  lineDirection: {
    ...type.bodyMedium,
    fontWeight: '500',
    color: scheme.onSurface,
  },
  hoursInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  hoursInlineText: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
  },
  changePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  changePillText: {
    ...type.labelSmall,
    fontWeight: '700',
  },
  schematicWrap: {
    backgroundColor: scheme.surface,
    borderRadius: shape.large,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 38,
    gap: 12,
  },
  trackRailCol: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  railSegmentUpper: {
    position: 'absolute',
    top: 0,
    height: '50%',
    width: 2,
  },
  railSegmentLower: {
    position: 'absolute',
    bottom: 0,
    height: '50%',
    width: 2,
  },
  nodeAnchor: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2.5,
    borderColor: scheme.primary,
    backgroundColor: scheme.surface,
  },
  nodeDetour: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: scheme.primary,
  },
  nodeTransferOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: scheme.primary,
    backgroundColor: scheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeTransferInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: scheme.primary,
  },
  nodeOmittedWrap: {
    backgroundColor: scheme.surface,
    borderRadius: 8,
  },
  trackTextCol: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 6,
  },
  trackStopName: {
    ...type.bodyMedium,
    color: scheme.onSurface,
  },
  trackStopStrong: {
    fontWeight: '600',
  },
  trackStopOmitted: {
    color: scheme.onSurfaceVariant,
    textDecorationLine: 'line-through',
  },
  trackSublabel: {
    ...type.labelSmall,
    color: scheme.onSurfaceVariant,
    marginTop: 1,
  },
  replacementBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.medium,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  replacementLabel: {
    ...type.labelMedium,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  replacementValue: {
    ...type.bodyMedium,
    color: scheme.onSurface,
    flexShrink: 1,
  },
  lineDetailsText: {
    ...type.bodyMedium,
    lineHeight: 20,
    color: scheme.onSurfaceVariant,
  },
  viaFlowRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: 8,
    columnGap: 4,
    backgroundColor: scheme.surface,
    borderRadius: shape.large,
    padding: 12,
  },
  viaFlowItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viaArrow: {
    marginHorizontal: 4,
  },
  viaStopChip: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  viaStopEndpoint: {
    color: scheme.onSurface,
    fontWeight: '600',
  },
  phasesTimeline: {
    gap: 4,
  },
  phaseRow: {
    flexDirection: 'row',
    gap: 12,
  },
  phaseRailCol: {
    width: 28,
    alignItems: 'center',
  },
  phaseConnector: {
    position: 'absolute',
    top: 28,
    bottom: -6,
    width: 2,
    backgroundColor: scheme.outlineVariant,
  },
  phaseIndexBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseIndexText: {
    ...type.labelMedium,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  phaseBody: {
    flex: 1,
    gap: 6,
    paddingBottom: 16,
  },
  phaseLabel: {
    ...type.titleSmall,
    fontWeight: '600',
    color: scheme.onSurface,
  },
  phaseSummary: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 20,
  },
  inlineBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stopsContainer: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  stopRow: {
    paddingVertical: 12,
    gap: 8,
  },
  stopRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: scheme.outlineVariant,
  },
  stopTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  stopNameGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  stopNameText: {
    ...type.bodyLarge,
    fontWeight: '500',
    color: scheme.onSurface,
    flexShrink: 1,
  },
  stopActionChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: shape.full,
  },
  stopActionText: {
    ...type.labelSmall,
    fontWeight: '700',
  },
  stopDetailsText: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 18,
  },
});
