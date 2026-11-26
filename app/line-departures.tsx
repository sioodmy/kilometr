import { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScreenTransitionSettled } from '../src/hooks/useScreenTransitionSettled';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  RouteOff,
} from '../src/components/icons';
import { LineBadge, resolveLegBadgeColors } from '../src/components/LineBadge';
import { MorphingLoader } from '../src/components/MorphingLoader';
import { SpringPressable } from '../src/components/SpringPressable';
import { TimetableDeparturesView } from '../src/components/TimetableDeparturesView';
import { getLocaleSync, useStrings } from '../src/i18n';
import { isFareBoundary } from '../src/gtfs/fareBoundary';
import {
  formatTimetableDateCompact,
  lastPhysicalStopIndex,
  parseClockToSeconds,
  shiftTimetableDate,
  timetableToday,
} from '../src/services/lineTimetable';
import { useLineTimetable } from '../src/services/useLineTimetable';
import { resolveRailStrokeColor } from '../src/theme/colorContrast';
import { useWebLayout } from '../src/theme/layout';
import { elev, scheme, shape, type } from '../src/theme/tokens';

/** Zwraca aktualny czas dnia w sekundach w strefie Europe/Warsaw. */
function nowSecondsInWarsaw(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const s = Number(parts.find((p) => p.type === 'second')?.value ?? 0);
  return (h % 24) * 3600 + m * 60 + s;
}

/** Pełnoekranowy widok odjazdów z przystanku spójny z ekranem rozkładu linii. */
export default function LineDeparturesScreen() {
  const params = useLocalSearchParams<{
    routeId: string;
    date: string;
    patternId: string;
    stopIndex: string;
    departAt?: string;
    dbTarget?: string;
  }>();

  const routeId = params.routeId ?? '';
  const initialDate = params.date ?? timetableToday();
  const dbTarget = params.dbTarget;
  const [date, setDate] = useState(initialDate);
  const isToday = date === timetableToday();
  const [nowSec, setNowSec] = useState(nowSecondsInWarsaw);

  useEffect(() => {
    setDate(initialDate);
  }, [initialDate]);

  useEffect(() => {
    if (!isToday) return;
    setNowSec(nowSecondsInWarsaw());
    const tick = setInterval(() => setNowSec(nowSecondsInWarsaw()), 30_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowSec(nowSecondsInWarsaw());
    });
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, [isToday]);

  const router = useRouter();
  const insets = useSafeAreaInsets();
  const webLayout = useWebLayout();
  const s = useStrings();
  const t = s.lineTimetable;
  const transitionSettled = useScreenTransitionSettled();
  const { data, loading, error, retry } = useLineTimetable(routeId, date, {
    dbTarget,
    defer: !transitionSettled,
  });

  const pattern = data?.patterns.find((item) => item.id === params.patternId);
  const stopIndex = Number(params.stopIndex ?? -1);
  const rawStop =
    Number.isInteger(stopIndex) && stopIndex >= 0 ? pattern?.stops[stopIndex] : undefined;
  const stop = rawStop && !isFareBoundary(rawStop.name) ? rawStop : undefined;
  const terminal =
    !!stop && !!pattern && stopIndex === lastPhysicalStopIndex(pattern.stops);
  const dateCompact = useMemo(
    () => formatTimetableDateCompact(date, getLocaleSync()),
    [date, s],
  );
  const plannedDepartSec = useMemo(
    () => parseClockToSeconds(params.departAt),
    [params.departAt],
  );

  const railStroke = useMemo(() => {
    if (!data?.line) return scheme.primary;
    const { bg } = resolveLegBadgeColors({
      mode: data.line.mode,
      line: data.line.shortName,
    });
    return resolveRailStrokeColor(bg, scheme.surfaceContainer);
  }, [data?.line]);

  const goBack = () =>
    router.canGoBack()
      ? router.back()
      : router.replace({
          pathname: '/line',
          params: { routeId, ...(dbTarget ? { dbTarget } : {}) },
        });

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={[styles.topBar, webLayout.isMedium && styles.topBarDesktop]}>
        <SpringPressable
          onPress={goBack}
          haptic="selection"
          scaleDelta={0.05}
          accessibilityRole="button"
          accessibilityLabel={t.back}
          style={styles.backBtn}
        >
          <ChevronLeft size={22} color={scheme.onSurface} />
        </SpringPressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {t.departures}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, 16) + 28 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {stop && data?.line && (
          <View style={styles.heroCard}>
            <View style={styles.heroIdentity}>
              <LineBadge
                line={data.line.shortName}
                mode={data.line.mode}
                size="large"
              />
              <View style={styles.heroTextCol}>
                <Text style={styles.stopName} accessibilityRole="header">
                  {stop.name}
                </Text>
                {!!stop.code && (
                  <View style={styles.codePill}>
                    <Text style={styles.codePillText}>{t.stopCode(stop.code)}</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.directionBar}>
              <View style={[styles.directionDot, { backgroundColor: railStroke }]} />
              <View style={styles.directionCol}>
                <Text style={styles.directionEyebrow}>{t.direction}</Text>
                <Text style={styles.directionValue} numberOfLines={2}>
                  {pattern?.headsign}
                </Text>
              </View>
            </View>
          </View>
        )}

        <View style={styles.dateBar}>
          <SpringPressable
            onPress={() => setDate(shiftTimetableDate(date, -1))}
            haptic="selection"
            scaleDelta={0.06}
            accessibilityRole="button"
            accessibilityLabel={t.previousDay}
            style={styles.dateStepBtn}
          >
            <ChevronLeft size={20} color={scheme.onSurface} />
          </SpringPressable>

          <View style={styles.dateCenter}>
            <Text style={styles.dateLabel} numberOfLines={1}>
              {dateCompact}
            </Text>
            {!isToday && (
              <SpringPressable
                onPress={() => setDate(timetableToday())}
                haptic="selection"
                scaleDelta={0.04}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                style={styles.todayPill}
              >
                <Text style={styles.todayPillText}>{s.common.today}</Text>
              </SpringPressable>
            )}
          </View>

          <SpringPressable
            onPress={() => setDate(shiftTimetableDate(date, 1))}
            haptic="selection"
            scaleDelta={0.06}
            accessibilityRole="button"
            accessibilityLabel={t.nextDay}
            style={styles.dateStepBtn}
          >
            <ChevronRight size={20} color={scheme.onSurface} />
          </SpringPressable>
        </View>

        {loading || error || !stop ? (
          <View style={styles.stateCard} accessibilityLiveRegion="polite">
            {loading ? (
              <>
                <MorphingLoader variant="contained" size={32} />
                <Text style={styles.stateBody}>{t.loading}</Text>
              </>
            ) : error ? (
              <>
                <View style={styles.stateIconCircle}>
                  <AlertCircle size={24} color={scheme.onSecondaryContainer} />
                </View>
                <Text style={styles.stateBody} accessibilityRole="alert">
                  {t.error}
                </Text>
                <SpringPressable
                  onPress={retry}
                  haptic="selection"
                  accessibilityRole="button"
                  style={styles.statePrimaryBtn}
                >
                  <RefreshCw size={16} color={scheme.onPrimary} />
                  <Text style={styles.statePrimaryBtnText}>{s.common.retry}</Text>
                </SpringPressable>
              </>
            ) : (
              <>
                <View style={styles.stateIconCircle}>
                  <RouteOff size={24} color={scheme.onSecondaryContainer} />
                </View>
                <Text style={styles.stateBody}>{t.missingStop}</Text>
              </>
            )}
          </View>
        ) : (
          <TimetableDeparturesView
            stop={stop}
            terminal={terminal}
            isToday={isToday}
            nowSec={nowSec}
            railStroke={railStroke}
            plannedDepartSec={plannedDepartSec}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: scheme.surface,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  topBarDesktop: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: scheme.onSurface,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 4,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    gap: 14,
  },
  heroCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 16,
    gap: 14,
    ...elev.level1,
  },
  heroIdentity: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  heroTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  stopName: {
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: scheme.onSurface,
  },
  codePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: shape.small,
    backgroundColor: scheme.secondaryContainer,
  },
  codePillText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  directionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  directionDot: {
    width: 10,
    height: 10,
    borderRadius: shape.full,
    flexShrink: 0,
  },
  directionCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  directionEyebrow: {
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: scheme.onSurfaceVariant,
  },
  directionValue: {
    ...type.titleSmall,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 5,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  dateStepBtn: {
    width: 44,
    height: 44,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateCenter: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  dateLabel: {
    ...type.titleSmall,
    fontSize: 15,
    fontWeight: '700',
    color: scheme.onSurface,
    textAlign: 'center',
  },
  todayPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
    backgroundColor: scheme.primaryContainer,
  },
  todayPillText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onPrimaryContainer,
  },
  stateCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 14,
    ...elev.level1,
  },
  stateIconCircle: {
    width: 52,
    height: 52,
    borderRadius: shape.full,
    backgroundColor: scheme.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateBody: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 300,
  },
  statePrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 22,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    justifyContent: 'center',
  },
  statePrimaryBtnText: {
    ...type.labelLarge,
    fontWeight: '700',
    color: scheme.onPrimary,
  },
});
