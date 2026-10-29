import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, ChevronLeft, ChevronRight } from '../src/components/icons';
import { getLocaleSync, useStrings } from '../src/i18n';
import { LineBadge } from '../src/components/LineBadge';
import { useLineTimetable } from '../src/services/useLineTimetable';
import { shiftTimetableDate, timetableToday, type LineStop } from '../src/services/lineTimetable';
import { scheme, shape, type } from '../src/theme/tokens';

export default function LineScreen() {
  const { routeId } = useLocalSearchParams<{ routeId: string }>();
  const router = useRouter();
  const s = useStrings();
  const t = s.lineTimetable;
  const [date, setDate] = useState(timetableToday);
  const { data, loading, error, retry } = useLineTimetable(routeId ?? '', date);
  const [patternId, setPatternId] = useState('');

  const pattern = data?.patterns.find((item) => item.id === patternId) ?? data?.patterns[0];
  const dateLabel = new Intl.DateTimeFormat(getLocaleSync(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00Z`));

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.toolbar}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={t.back}
          style={styles.iconButton}
          android_ripple={{ color: scheme.outlineVariant }}
        >
          <ArrowLeft size={24} color={scheme.onSurface} />
        </Pressable>
        <Text style={styles.toolbarTitle}>{t.title}</Text>
      </View>
      <FlatList
        data={loading || error ? [] : (pattern?.stops ?? [])}
        keyExtractor={(item, index) => `${item.id}:${index}`}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            {data?.line && (
              <View style={styles.identity}>
                <LineBadge line={data.line.shortName} mode={data.line.mode} size="large" />
                <View style={styles.identityText}>
                  <Text style={styles.title}>{t.line(data.line.shortName)}</Text>
                  {!!data.line.longName && (
                    <Text style={styles.subtitle}>{data.line.longName}</Text>
                  )}
                </View>
              </View>
            )}
            <View style={styles.dateRow}>
              <Pressable
                onPress={() => setDate(shiftTimetableDate(date, -1))}
                accessibilityRole="button"
                accessibilityLabel={t.previousDay}
                style={styles.iconButton}
                android_ripple={{ color: scheme.outlineVariant }}
              >
                <ChevronLeft size={24} color={scheme.onSurface} />
              </Pressable>
              <View style={styles.dateText}>
                <Text style={styles.dateLabel}>{dateLabel}</Text>
                {date !== timetableToday() && (
                  <Pressable
                    onPress={() => setDate(timetableToday())}
                    accessibilityRole="button"
                    style={styles.todayButton}
                  >
                    <Text style={styles.todayText}>{s.common.today}</Text>
                  </Pressable>
                )}
              </View>
              <Pressable
                onPress={() => setDate(shiftTimetableDate(date, 1))}
                accessibilityRole="button"
                accessibilityLabel={t.nextDay}
                style={styles.iconButton}
                android_ripple={{ color: scheme.outlineVariant }}
              >
                <ChevronRight size={24} color={scheme.onSurface} />
              </Pressable>
            </View>
            {!!data?.patterns.length && (
              <>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                  {t.direction}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.directions}
                >
                  {data.patterns.map((item, index) => {
                    const selected = item.id === pattern?.id;
                    const duplicate =
                      data.patterns.filter((other) => other.headsign === item.headsign).length > 1;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => setPatternId(item.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={[styles.direction, selected && styles.directionSelected]}
                        android_ripple={{ color: scheme.outlineVariant }}
                      >
                        <View style={styles.directionTitle}>
                          {selected && <Check size={18} color={scheme.onPrimaryContainer} />}
                          <Text
                            style={[styles.directionText, selected && styles.directionTextSelected]}
                          >
                            {item.headsign}
                          </Text>
                        </View>
                        <Text
                          style={[styles.directionOrigin, selected && styles.directionTextSelected]}
                        >
                          {item.stops[0].name}
                          {duplicate ? ` · ${t.variant(index + 1)}` : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Text style={styles.sectionTitle} accessibilityRole="header">
                  {t.stops}
                </Text>
                <Text style={styles.subtitle}>{t.stopsHint}</Text>
              </>
            )}
          </View>
        }
        renderItem={({ item, index }: { item: LineStop; index: number }) => {
          const terminal = index === (pattern?.stops.length ?? 0) - 1;
          return (
            <View style={styles.stopGroup}>
              <Pressable
                onPress={() => {
                  if (!pattern) return;
                  router.push({
                    pathname: '/line-departures',
                    params: {
                      routeId,
                      date,
                      patternId: pattern.id,
                      stopIndex: String(index),
                    },
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={t.selectStop(item.name)}
                style={styles.stop}
                android_ripple={{ color: scheme.outlineVariant }}
              >
                <View style={styles.track}>
                  {index > 0 && <View style={styles.trackAbove} />}
                  {!terminal && <View style={styles.trackBelow} />}
                  <View style={styles.dot} />
                </View>
                <View style={styles.stopText}>
                  <Text style={styles.stopName}>{item.name}</Text>
                  {!!item.code && <Text style={styles.subtitle}>{t.stopCode(item.code)}</Text>}
                </View>
                <ChevronRight size={20} color={scheme.onSurfaceVariant} />
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.state} accessibilityLiveRegion="polite">
            {loading && <ActivityIndicator color={scheme.primary} />}
            <Text style={styles.stateText} accessibilityRole={error ? 'alert' : undefined}>
              {loading ? t.loading : error ? t.error : data?.line ? t.empty : t.missing}
            </Text>
            {error && (
              <Pressable onPress={retry} accessibilityRole="button" style={styles.retry}>
                <Text style={styles.retryText}>{s.common.retry}</Text>
              </Pressable>
            )}
          </View>
        }
      />
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
    paddingHorizontal: 16,
    paddingBottom: 32,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  header: { gap: 12, paddingTop: 16, paddingBottom: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  identityText: { flex: 1, gap: 4 },
  title: { ...type.displaySmall, fontWeight: '700', color: scheme.onSurface },
  subtitle: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    padding: 4,
  },
  dateText: { flex: 1, alignItems: 'center' },
  dateLabel: {
    ...type.labelLarge,
    color: scheme.onSurface,
    textAlign: 'center',
    paddingVertical: 8,
  },
  todayButton: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  todayText: { ...type.labelLarge, color: scheme.primary },
  sectionTitle: { ...type.titleMedium, fontWeight: '700', color: scheme.onSurface, marginTop: 8 },
  directions: { gap: 8 },
  direction: {
    borderRadius: shape.large,
    padding: 16,
    gap: 6,
    minHeight: 80,
    maxWidth: 260,
    borderWidth: 1,
    borderColor: scheme.outline,
    backgroundColor: scheme.surfaceContainerLow,
  },
  directionSelected: { backgroundColor: scheme.primaryContainer, borderColor: scheme.primary },
  directionTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  directionText: { ...type.titleMedium, color: scheme.onSurface, flexShrink: 1 },
  directionTextSelected: { color: scheme.onPrimaryContainer },
  directionOrigin: { ...type.bodySmall, color: scheme.onSurfaceVariant },
  stopGroup: { marginBottom: 2 },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    paddingRight: 16,
    gap: 12,
    borderRadius: shape.medium,
    backgroundColor: scheme.surfaceContainerLow,
  },
  track: {
    width: 36,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  trackAbove: {
    position: 'absolute',
    top: 0,
    bottom: '50%',
    width: 2,
    backgroundColor: scheme.outline,
  },
  trackBelow: {
    position: 'absolute',
    top: '50%',
    bottom: -2,
    width: 2,
    backgroundColor: scheme.outline,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: shape.full,
    borderWidth: 2,
    borderColor: scheme.outline,
    backgroundColor: scheme.surfaceContainerLow,
  },
  stopText: { flex: 1, paddingVertical: 14, gap: 4 },
  stopName: { ...type.bodyLarge, color: scheme.onSurface },
  state: { paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center', gap: 16 },
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
