// Karta prognozy punktualności dla szczegółów połączenia (zasilana przez api.kilometr.app).
// Renderuje się wyłącznie wtedy, gdy backend odpowiada i posiada wystarczającą
// próbę danych historycznych lub live; w trybie offline zwraca null.

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';
import { Clock3, TriangleAlert } from './icons';
import { LineBadge } from './LineBadge';
import { useStrings } from '../i18n';
import { useActiveCity } from '../services/cityStore';
import { fetchBackendRouteInsights, type RouteInsightsData } from '../services/kilometrApi';
import { elev, scheme, shape, type } from '../theme/tokens';
import type { Connection } from '../types/models';

interface RouteReliabilityCardProps {
  connection: Connection;
}

const CHART_W = 288;
const CHART_H = 104;
const BAR_AREA_TOP = 24;
const BAR_AREA_H = 54;
const LABEL_Y = 96;

function formatHour(h: number): string {
  return `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
}

function riskTone(level: RouteInsightsData['riskLevel']) {
  if (level === 'high') {
    return {
      container: scheme.errorContainer,
      onContainer: scheme.onErrorContainer,
      accent: scheme.error,
    };
  }
  if (level === 'moderate') {
    return {
      container: scheme.warningContainer,
      onContainer: scheme.onWarningContainer,
      accent: scheme.warning,
    };
  }
  return {
    container: scheme.successContainer,
    onContainer: scheme.onSuccessContainer,
    accent: scheme.primary,
  };
}

export function RouteReliabilityCard({ connection }: RouteReliabilityCardProps) {
  const s = useStrings();
  const { cityId } = useActiveCity();
  const [insights, setInsights] = useState<RouteInsightsData | null>(null);

  const requestKey = `${cityId}|${connection.id}|${connection.serviceDate ?? ''}|${connection.departureSec}`;

  useEffect(() => {
    const hasTransit = connection.legs.some((l) => l.mode !== 'walk');
    if (!hasTransit) {
      setInsights(null);
      return;
    }
    let active = true;
    const ctrl = new AbortController();
    void fetchBackendRouteInsights(cityId, connection, ctrl.signal)
      .then((data) => {
        if (active) setInsights(data && data.ready ? data : null);
      })
      .catch(() => {
        if (active) setInsights(null);
      });
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [cityId, connection, requestKey]);

  if (!insights || !insights.ready) return null;

  const t = s.routeInsights;
  const tone = riskTone(insights.riskLevel);
  const expectedMin = Math.max(0, Math.round(insights.expectedDelaySec / 60));
  const p90Min = Math.max(expectedMin, Math.round(insights.p90DelaySec / 60));
  const dayLabel =
    insights.dayType === 'saturday'
      ? t.daySaturday
      : insights.dayType === 'sunday'
        ? t.daySunday
        : t.dayWeekday;

  const verdict =
    insights.riskLevel === 'high'
      ? t.verdictHigh
      : insights.riskLevel === 'moderate'
        ? t.verdictModerate
        : t.verdictLow;

  const profile = insights.hourlyProfile;
  const hasChartData = profile.some((p) => p.sampleCount > 0 && p.avgDelaySec > 0);
  const maxDelaySec = Math.max(
    240,
    ...profile.map((p) => Math.max(p.avgDelaySec, 0)),
  );

  const slotW = profile.length > 0 ? CHART_W / profile.length : CHART_W;
  const barW = Math.min(34, Math.max(20, slotW - 18));

  return (
    <View style={styles.card} accessible={false}>
      <View style={styles.headerRow}>
        <View style={[styles.iconBox, { backgroundColor: tone.container }]}>
          {insights.riskLevel === 'high' ? (
            <TriangleAlert size={20} color={tone.onContainer} />
          ) : (
            <Clock3 size={20} color={tone.onContainer} />
          )}
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={2}>
            {verdict}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {insights.focusLine
              ? t.basisLine(insights.focusLine, dayLabel, insights.sampleCount)
              : t.basisGeneric(dayLabel, insights.sampleCount)}
          </Text>
        </View>
        {expectedMin >= 1 ? (
          <View style={[styles.metricPill, { backgroundColor: tone.container }]}>
            <Text style={[styles.metricValue, { color: tone.onContainer }]}>
              {`+${expectedMin} min`}
            </Text>
            {p90Min > expectedMin ? (
              <Text style={[styles.metricSub, { color: tone.onContainer }]}>
                {t.upToMin(p90Min)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      {hasChartData && profile.length > 0 && (
        <View style={styles.chartBox}>
          <View style={styles.chartHeader}>
            {insights.focusLine ? (
              <View style={styles.chartLineTag}>
                <LineBadge line={insights.focusLine} compact />
                <Text style={styles.chartCaption}>{t.chartCaption}</Text>
              </View>
            ) : (
              <Text style={styles.chartCaption}>{t.chartCaption}</Text>
            )}
            <Text style={styles.chartLegend}>{t.yourDeparture}</Text>
          </View>

          <Svg
            width="100%"
            height={CHART_H}
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            accessible
            accessibilityLabel={t.chartA11y(
              insights.focusLine ?? '',
              formatHour(insights.focusHour),
              expectedMin,
            )}
          >
            {profile.map((point, idx) => {
              const cx = idx * slotW + slotW / 2;
              const x = cx - barW / 2;
              const minVal = Math.round(point.avgDelaySec / 60);
              const ratio = point.avgDelaySec > 0 ? Math.min(1, point.avgDelaySec / maxDelaySec) : 0;
              const h = point.sampleCount > 0 ? Math.max(6, Math.round(ratio * BAR_AREA_H)) : 4;
              const y = BAR_AREA_TOP + (BAR_AREA_H - h);
              const fill = point.isDepartureHour
                ? tone.accent
                : point.avgDelaySec >= 300
                  ? scheme.error + '88'
                  : point.avgDelaySec >= 150
                    ? scheme.warning + '88'
                    : scheme.surfaceContainerHighest;

              return (
                <G key={point.hour}>
                  <SvgText
                    x={cx}
                    y={y - 6}
                    fontSize={11}
                    fontWeight={point.isDepartureHour ? '700' : '600'}
                    fill={point.isDepartureHour ? scheme.onSurface : scheme.onSurfaceVariant}
                    textAnchor="middle"
                  >
                    {point.sampleCount > 0 ? (minVal > 0 ? `+${minVal}m` : '0m') : '·'}
                  </SvgText>
                  <Rect
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    rx={8}
                    ry={8}
                    fill={fill}
                  />
                  <SvgText
                    x={cx}
                    y={LABEL_Y}
                    fontSize={11}
                    fontWeight={point.isDepartureHour ? '700' : '500'}
                    fill={point.isDepartureHour ? scheme.onSurface : scheme.onSurfaceVariant}
                    textAnchor="middle"
                  >
                    {formatHour(point.hour)}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
        </View>
      )}

      {(insights.hotspot || insights.transferRisks.length > 0 || insights.activeAnomaly) && (
        <View style={styles.factorsCol}>
          {insights.activeAnomaly && (
            <View style={[styles.factorRow, { backgroundColor: scheme.errorContainer }]}>
              <TriangleAlert size={16} color={scheme.onErrorContainer} />
              <Text style={[styles.factorText, { color: scheme.onErrorContainer }]}>
                {t.activeJamFactor(
                  insights.activeAnomaly.locationName,
                  Math.max(1, Math.round(insights.activeAnomaly.avgDelaySec / 60)),
                )}
              </Text>
            </View>
          )}

          {insights.hotspot && (
            <View style={styles.factorRowNeutral}>
              <Clock3 size={15} color={scheme.warning} />
              <Text style={styles.factorTextNeutral}>
                {insights.hotspot.deltaVsTypicalSec != null &&
                Math.round(insights.hotspot.deltaVsTypicalSec / 60) >= 2
                  ? t.hotspotWithDelta(
                      insights.hotspot.name,
                      Math.max(1, Math.round(insights.hotspot.avgDelaySec / 60)),
                      Math.round(insights.hotspot.deltaVsTypicalSec / 60),
                    )
                  : t.hotspotNow(
                      insights.hotspot.name,
                      Math.max(1, Math.round(insights.hotspot.avgDelaySec / 60)),
                    )}
              </Text>
            </View>
          )}

          {insights.transferRisks.slice(0, 2).map((trItem, i) => (
            <View
              key={`${trItem.fromLine}-${trItem.toLine}-${i}`}
              style={[
                styles.factorRow,
                {
                  backgroundColor:
                    trItem.risk === 'risky' ? scheme.errorContainer : scheme.warningContainer,
                },
              ]}
            >
              <TriangleAlert
                size={15}
                color={
                  trItem.risk === 'risky' ? scheme.onErrorContainer : scheme.onWarningContainer
                }
              />
              <Text
                style={[
                  styles.factorText,
                  {
                    color:
                      trItem.risk === 'risky'
                        ? scheme.onErrorContainer
                        : scheme.onWarningContainer,
                  },
                ]}
              >
                {t.transferRisk(
                  trItem.stopName,
                  Math.max(1, Math.round(trItem.marginSec / 60)),
                  trItem.fromLine,
                  Math.max(1, Math.round(trItem.feederP90DelaySec / 60)),
                )}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 16,
    gap: 14,
    ...elev.level1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...type.titleSmall,
    color: scheme.onSurface,
    fontWeight: '700',
  },
  subtitle: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
  },
  metricPill: {
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignItems: 'flex-end',
  },
  metricValue: {
    ...type.labelLarge,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricSub: {
    ...type.labelSmall,
    opacity: 0.9,
    fontVariant: ['tabular-nums'],
  },
  chartBox: {
    borderRadius: shape.large,
    backgroundColor: scheme.surfaceContainer,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 6,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  chartLineTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  chartCaption: {
    ...type.labelMedium,
    color: scheme.onSurfaceVariant,
    fontWeight: '600',
  },
  chartLegend: {
    ...type.labelSmall,
    color: scheme.primary,
    fontWeight: '700',
  },
  factorsCol: {
    gap: 8,
  },
  factorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: shape.medium,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  factorText: {
    flex: 1,
    ...type.bodySmall,
    fontWeight: '600',
  },
  factorRowNeutral: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerHigh,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  factorTextNeutral: {
    flex: 1,
    ...type.bodySmall,
    color: scheme.onSurface,
    fontWeight: '500',
  },
});
