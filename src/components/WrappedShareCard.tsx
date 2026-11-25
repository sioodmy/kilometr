// Prywatna karta podsumowania podrozy do udostepniania w social media ("Wrapped").
// Przyjmuje wylacznie WrappedSafeSummary, wiec typowo uniemozliwia pokazanie
// celow podrozy, nazw miast ani numerow linii.

import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useStrings } from '../i18n';
import type { WrappedSafeSummary } from '../services/userStatsModel';
import { WRAPPED_PALETTE } from '../services/wrappedExport';
import { shape, type } from '../theme/tokens';
import { BusFront, CableCar, Clock3, Eco, Footprints, Layers, TrainFront, TramFront } from './icons';
import type { LegMode } from '../types/models';

function KilometrBrandMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024" fill="none">
      <Rect width="1024" height="1024" rx="232" fill="#00a884" />
      <G transform="translate(512, 512) scale(0.82) translate(-512, -512)">
        <G
          fill="none"
          stroke="#04362c"
          strokeWidth="80"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Line x1="352" y1="180" x2="352" y2="794" />
          <Path d="M 352 512 C 390 380, 480 300, 600 220" />
          <Path d="M 352 512 C 400 664, 510 754, 672 754" />
        </G>
        <G transform="translate(605, 215) rotate(-35)">
          <Path
            d="M -18 -68 L 96 0 L -18 68 L 8 0 Z"
            fill="#04362c"
            stroke="#04362c"
            strokeWidth="40"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </G>
        <Circle cx="352" cy="512" r="102" fill="#04362c" />
        <Circle cx="352" cy="512" r="50" fill="#00a884" />
        <Circle cx="672" cy="754" r="32" fill="#04362c" />
      </G>
    </Svg>
  );
}

function ModeIcon({ mode, color, size = 14 }: { mode: LegMode; color: string; size?: number }) {
  if (mode === 'tram') return <TramFront size={size} color={color} />;
  if (mode === 'train' || mode === 'subway') return <TrainFront size={size} color={color} />;
  if (mode === 'cable') return <CableCar size={size} color={color} />;
  if (mode === 'walk') return <Footprints size={size} color={color} />;
  return <BusFront size={size} color={color} />;
}

export function WrappedShareCard({ summary }: { summary: WrappedSafeSummary }) {
  const s = useStrings();
  const y = s.yourData;
  const palette = WRAPPED_PALETTE;
  const activeModes = summary.modes.filter((m) => m.share > 0);

  const thirdTile =
    summary.railTrips > 0
      ? {
          icon: TrainFront,
          label: y.railTitle,
          value:
            summary.railDistanceKm > 0
              ? y.formatKm(summary.railDistanceKm)
              : String(summary.railTrips),
        }
      : {
          icon: Layers,
          label: summary.totalStops > 0 ? y.stopsLabel : y.citiesLabel,
          value: String(summary.totalStops > 0 ? summary.totalStops : summary.citiesCount),
        };

  const fourthTile =
    summary.totalWalkKm >= 0.5
      ? {
          icon: Footprints,
          label: y.walkLabel,
          value: y.formatKm(summary.totalWalkKm),
        }
      : {
          icon: Eco,
          label: y.co2Label,
          value: y.formatCo2(summary.estimatedCo2SavedKg),
        };

  const ThirdIcon = thirdTile.icon;
  const FourthIcon = fourthTile.icon;

  return (
    <View style={[styles.card, { borderColor: palette.surfaceBorder }]}>
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox="0 0 360 450"
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          <LinearGradient id={`wrapBg_${themeId}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.bgTop} />
            <Stop offset="1" stopColor={palette.bgBottom} />
          </LinearGradient>
        </Defs>
        <Rect width="360" height="450" fill={`url(#wrapBg_${themeId})`} />
        <Path
          d="M 215 -10 C 232 74, 286 96, 372 108"
          stroke={palette.trackStroke}
          strokeWidth={2.2}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M 248 -10 C 266 86, 308 130, 372 154"
          stroke={palette.trackStroke}
          strokeWidth={2.2}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d="M -10 362 C 74 348, 138 388, 186 460"
          stroke={palette.trackStroke}
          strokeWidth={2.2}
          fill="none"
          strokeLinecap="round"
        />
        <Circle cx="76" cy="368" r="4.5" fill={palette.bgBottom} stroke={palette.accent} strokeWidth="2" />
      </Svg>

      <View style={styles.inner}>
        {/* Naglowek marki i roku */}
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            <KilometrBrandMark size={28} />
            <Text style={[styles.brandName, { color: palette.ink }]}>Kilometr</Text>
          </View>
          <View style={[styles.yearPill, { backgroundColor: palette.accentSoft }]}>
            <Text style={[styles.yearText, { color: palette.accent }]}>{summary.year}</Text>
          </View>
        </View>

        {/* Glowna liczba: przejechany dystans */}
        <View style={styles.heroBlock}>
          <Text style={[styles.heroLabel, { color: palette.muted }]}>{y.distanceLabel}</Text>
          <Text
            style={[styles.heroValue, { color: palette.ink }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {y.formatKm(summary.totalDistanceKm)}
          </Text>
          <View style={[styles.archetypePill, { backgroundColor: palette.accent }]}>
            <Text style={[styles.archetypeText, { color: palette.accentText }]}>
              {y.archetypes[summary.archetype]}
            </Text>
          </View>
        </View>

        {/* Siatka 2x2 kafelkow */}
        <View style={styles.grid}>
          <View style={styles.gridRow}>
            <View
              style={[
                styles.tile,
                { backgroundColor: palette.surface, borderColor: palette.surfaceBorder },
              ]}
            >
              <View style={styles.tileHead}>
                <TramFront size={14} color={palette.accent} />
                <Text style={[styles.tileLabel, { color: palette.muted }]}>{y.tripsLabel}</Text>
              </View>
              <Text style={[styles.tileValue, { color: palette.ink }]}>{summary.totalTrips}</Text>
            </View>
            <View
              style={[
                styles.tile,
                { backgroundColor: palette.surface, borderColor: palette.surfaceBorder },
              ]}
            >
              <View style={styles.tileHead}>
                <Clock3 size={14} color={palette.accent} />
                <Text style={[styles.tileLabel, { color: palette.muted }]}>{y.timeLabel}</Text>
              </View>
              <Text
                style={[styles.tileValue, { color: palette.ink }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {y.formatDuration(summary.totalDurationMin)}
              </Text>
            </View>
          </View>

          <View style={styles.gridRow}>
            <View
              style={[
                styles.tile,
                { backgroundColor: palette.surface, borderColor: palette.surfaceBorder },
              ]}
            >
              <View style={styles.tileHead}>
                <ThirdIcon size={14} color={palette.accent} />
                <Text style={[styles.tileLabel, { color: palette.muted }]}>{thirdTile.label}</Text>
              </View>
              <Text
                style={[styles.tileValue, { color: palette.ink }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {thirdTile.value}
              </Text>
            </View>
            <View
              style={[
                styles.tile,
                { backgroundColor: palette.surface, borderColor: palette.surfaceBorder },
              ]}
            >
              <View style={styles.tileHead}>
                <FourthIcon size={14} color={palette.accent} />
                <Text style={[styles.tileLabel, { color: palette.muted }]}>{fourthTile.label}</Text>
              </View>
              <Text
                style={[styles.tileValue, { color: palette.ink }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {fourthTile.value}
              </Text>
            </View>
          </View>
        </View>

        {/* Pasek podzialu srodkow transportu */}
        {activeModes.length > 0 && (
          <View
            style={[
              styles.modesBox,
              { backgroundColor: palette.surface, borderColor: palette.surfaceBorder },
            ]}
          >
            <Text style={[styles.modesTitle, { color: palette.muted }]}>{y.railSectionTitle}</Text>
            <View style={[styles.barTrack, { backgroundColor: palette.bgBottom }]}>
              {activeModes.map((m) => (
                <View
                  key={m.mode}
                  style={[
                    styles.barSegment,
                    {
                      flex: Math.max(0.08, m.share),
                      backgroundColor: palette.modeColors[m.mode] ?? palette.accent,
                    },
                  ]}
                />
              ))}
            </View>
            <View style={styles.modesLegend}>
              {activeModes.map((m) => (
                <View key={m.mode} style={styles.modeChip}>
                  <ModeIcon
                    mode={m.mode}
                    size={13}
                    color={palette.modeColors[m.mode] ?? palette.accent}
                  />
                  <Text style={[styles.modeChipText, { color: palette.ink }]}>
                    {y.modes[m.mode]} {Math.max(1, Math.round(m.share * 100))}%
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Stopka */}
        <View style={styles.footer}>
          <Text style={[styles.footerNote, { color: palette.muted }]}>{y.wrappedFooter}</Text>
          <Text style={[styles.footerBrand, { color: palette.accent }]}>kilometr.app</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: shape.extraLarge,
    overflow: 'hidden',
    borderWidth: 1,
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
  },
  inner: {
    padding: 22,
    gap: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  brandName: {
    ...type.titleMedium,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  yearPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  yearText: {
    ...type.labelLarge,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  heroBlock: {
    gap: 6,
    paddingTop: 2,
  },
  heroLabel: {
    ...type.labelLarge,
  },
  heroValue: {
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '800',
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
  archetypePill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 13,
    paddingVertical: 6,
    borderRadius: shape.full,
    marginTop: 4,
  },
  archetypeText: {
    ...type.labelMedium,
    fontWeight: '700',
  },
  grid: {
    gap: 10,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  tile: {
    flex: 1,
    borderRadius: shape.large,
    borderWidth: 1,
    padding: 13,
    gap: 6,
  },
  tileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tileLabel: {
    ...type.labelSmall,
    flexShrink: 1,
  },
  tileValue: {
    ...type.titleLarge,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  modesBox: {
    borderRadius: shape.large,
    borderWidth: 1,
    padding: 13,
    gap: 10,
  },
  modesTitle: {
    ...type.labelSmall,
  },
  barTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    gap: 3,
  },
  barSegment: {
    height: 10,
    borderRadius: 5,
  },
  modesLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  modeChipText: {
    ...type.labelSmall,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  footerNote: {
    ...type.labelSmall,
  },
  footerBrand: {
    ...type.labelMedium,
    fontWeight: '700',
  },
});
