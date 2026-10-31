import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from '../src/components/icons';
import { getLocaleSync, useStrings } from '../src/i18n';
import { LineBadge } from '../src/components/LineBadge';
import { timetableClock, timetableToday } from '../src/services/lineTimetable';
import { useLineTimetable } from '../src/services/useLineTimetable';
import { scheme, shape, type } from '../src/theme/tokens';

export default function LineDeparturesScreen() {
  const params = useLocalSearchParams<{
    routeId: string;
    date: string;
    patternId: string;
    stopIndex: string;
  }>();
  const routeId = params.routeId ?? '';
  const date = params.date ?? timetableToday();
  const router = useRouter();
  const s = useStrings();
  const t = s.lineTimetable;
  const { data, loading, error, retry } = useLineTimetable(routeId, date);
  const pattern = data?.patterns.find((item) => item.id === params.patternId);
  const stopIndex = Number(params.stopIndex ?? -1);
  const stop =
    Number.isInteger(stopIndex) && stopIndex >= 0 ? pattern?.stops[stopIndex] : undefined;
  const terminal = !!stop && stopIndex === (pattern?.stops.length ?? 0) - 1;
  const hours = useMemo(() => {
    const groups = new Map<number, string[]>();
    for (const seconds of stop?.departures ?? []) {
      const hour = Math.floor(seconds / 3600);
      const minutes = groups.get(hour) ?? [];
      const minute = timetableClock(seconds).slice(3);
      if (!minutes.includes(minute)) minutes.push(minute);
      groups.set(hour, minutes);
    }
    return [...groups];
  }, [stop]);
  const dateLabel = stop
    ? new Intl.DateTimeFormat(getLocaleSync(), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Warsaw',
      }).format(new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00Z`))
    : '';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.toolbar}>
        <Pressable
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace({ pathname: '/line', params: { routeId } })
          }
          accessibilityRole="button"
          accessibilityLabel={t.back}
          style={styles.iconButton}
          android_ripple={{ color: scheme.outlineVariant }}
        >
          <ArrowLeft size={24} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.toolbarTitle}>{t.departures}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {stop && data?.line && (
          <>
            <View style={styles.identity}>
              <LineBadge line={data.line.shortName} mode={data.line.mode} size="large" />
              <View style={styles.stopText}>
                <Text style={styles.stopName} accessibilityRole="header">
                  {stop.name}
                </Text>
                {!!stop.code && <Text style={styles.subtitle}>{t.stopCode(stop.code)}</Text>}
              </View>
            </View>
            <View style={styles.context}>
              <Text style={styles.subtitle}>{t.direction}</Text>
              <Text style={styles.direction}>{pattern?.headsign}</Text>
              <Text style={styles.date}>{dateLabel}</Text>
            </View>
          </>
        )}
        {loading || error || !stop || terminal ? (
          <View style={styles.state} accessibilityLiveRegion="polite">
            {loading && <ActivityIndicator color={scheme.primary} />}
            <Text style={styles.stateText} accessibilityRole={error ? 'alert' : undefined}>
              {loading ? t.loading : error ? t.error : terminal ? t.terminal : t.missingStop}
            </Text>
            {terminal && <Text style={styles.subtitle}>{t.terminalHint}</Text>}
            {error && (
              <Pressable onPress={retry} accessibilityRole="button" style={styles.retry}>
                <Text style={styles.retryText}>{s.common.retry}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.schedule}>
            <Text style={styles.subtitle}>{t.scheduled}</Text>
            {hours.map(([hour, minutes]) => (
              <View
                key={hour}
                style={styles.hourRow}
                accessible
                accessibilityLabel={minutes
                  .map((minute) => {
                    const time = timetableClock(hour * 3600 + Number(minute) * 60);
                    return hour >= 24 ? t.nextDayTime(time, Math.floor(hour / 24)) : time;
                  })
                  .join(', ')}
              >
                <View style={styles.hourLabel}>
                  <Text style={styles.hour}>{hour % 24}</Text>
                  {hour >= 24 && (
                    <Text style={styles.subtitle}>{t.dayOffset(Math.floor(hour / 24))}</Text>
                  )}
                </View>
                <View style={styles.minutes}>
                  {minutes.map((minute) => (
                    <Text key={minute} style={styles.minute}>
                      {minute}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: scheme.surface },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  toolbarTitle: { ...type.titleMedium, color: scheme.onSurface, flex: 1 },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 24,
    paddingBottom: 32,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
    gap: 24,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stopText: { flex: 1, gap: 6 },
  stopName: { ...type.headlineSmall, fontWeight: '700', color: scheme.onSurface },
  subtitle: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  context: { gap: 6 },
  direction: { ...type.titleMedium, color: scheme.onSurface },
  date: { ...type.bodyMedium, color: scheme.onSurfaceVariant, marginTop: 8 },
  schedule: { gap: 12 },
  hourRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 2 },
  hourLabel: { gap: 2 },
  hour: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '700',
    color: scheme.primary,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  minutes: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 2 },
  minute: {
    ...type.bodyMedium,
    lineHeight: 18,
    fontWeight: '600',
    color: scheme.onSurface,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  state: { paddingVertical: 32, alignItems: 'center', gap: 16 },
  stateText: { ...type.bodyLarge, color: scheme.onSurfaceVariant, textAlign: 'center' },
  retry: {
    minHeight: 48,
    paddingHorizontal: 24,
    justifyContent: 'center',
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
  },
  retryText: { ...type.labelLarge, color: scheme.onPrimary },
});
