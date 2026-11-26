import { memo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import {
  ArrowRight,
  Clock3,
  Footprints,
  M3SolidArrowDown,
  M3SolidArrowRight,
} from './icons';
import { useStrings, getLocaleSync } from '../i18n';
import { resolveRailStrokeColor } from '../theme/colorContrast';
import { elev, scheme, shape, type } from '../theme/tokens';
import {
  formatShareTime,
  transferCount,
  type SharedConnection,
  type SharedLeg,
} from '../sharing/connection';
import { LineBadge, resolveLegBadgeColors } from './LineBadge';

function KilometrBrandMark({ size = 24 }: { size?: number }) {
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

interface TransitStep {
  leg: SharedLeg;
  railColor: string;
  durationMin: number;
  platformText: string;
  transferAfter?: {
    waitMin: number;
    walkM?: number;
    stopName: string;
    departTime: string;
    arriveTime: string;
    nextPlatformText: string;
  };
}

const shareDateFormatters = new Map<string, Intl.DateTimeFormat>();
function formatShareCardDate(isoDate: string, locale: string): string {
  let formatter = shareDateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    shareDateFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(`${isoDate}T12:00:00Z`));
}

export const JourneyShareCard = memo(function JourneyShareCard({
  journey,
}: {
  journey: SharedConnection;
}) {
  const { share: s, city } = useStrings();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / fontScale < 305;

  const date = formatShareCardDate(journey.date, getLocaleSync());

  const arrivalDay = Math.floor(journey.arrival / 1440);
  const totalMin = Math.max(1, journey.arrival - journey.departure);
  const transitLegs = journey.legs.filter((leg) => leg.mode !== 'walk');
  const allWalk = transitLegs.length === 0;
  const transfersLabel = allWalk ? s.walk : s.transfers(transferCount(journey));

  // Wyciągamy opcjonalne dojście na początku i na końcu, żeby mini-oś pozostała zwięzła.
  const firstLeg = journey.legs[0];
  const lastLeg = journey.legs[journey.legs.length - 1];
  const leadingWalk =
    !allWalk && firstLeg?.mode === 'walk' && ((firstLeg.walk ?? 0) >= 40 || firstLeg.arrival - firstLeg.departure >= 2)
      ? firstLeg
      : null;
  const trailingWalk =
    !allWalk &&
    journey.legs.length > 1 &&
    lastLeg?.mode === 'walk' &&
    ((lastLeg.walk ?? 0) >= 40 || lastLeg.arrival - lastLeg.departure >= 2)
      ? lastLeg
      : null;

  // Budujemy zwartą sekwencję odcinków tranzytowych z łącznikami przesiadek.
  const steps: TransitStep[] = [];
  for (let i = 0; i < journey.legs.length; i++) {
    const leg = journey.legs[i];
    if (leg.mode === 'walk') continue;

    const badgeBg = resolveLegBadgeColors({
      mode: leg.mode,
      line: leg.line,
      compact: true,
      cityId: journey.city,
    }).bg;
    const railColor = resolveRailStrokeColor(badgeBg, scheme.surfaceContainerLow);

    // Szukamy kolejnego odcinka tranzytowego (z ewentualnym odcinkiem pieszym pomiędzy).
    let nextTransitIdx = -1;
    let walkBetweenM = 0;
    for (let j = i + 1; j < journey.legs.length; j++) {
      if (journey.legs[j].mode === 'walk') {
        walkBetweenM += journey.legs[j].walk ?? 0;
      } else {
        nextTransitIdx = j;
        break;
      }
    }

    const nextLeg = nextTransitIdx >= 0 ? journey.legs[nextTransitIdx] : null;
    const transferAfter = nextLeg
      ? {
          waitMin: Math.max(0, nextLeg.departure - leg.arrival),
          walkM: walkBetweenM > 0 ? walkBetweenM : undefined,
          stopName: leg.to === nextLeg.from ? leg.to : `${leg.to} \u2192 ${nextLeg.from}`,
          arriveTime: formatShareTime(leg.arrival),
          departTime: formatShareTime(nextLeg.departure),
          nextPlatformText: s.platformLabel(nextLeg.platform, nextLeg.track),
        }
      : undefined;

    steps.push({
      leg,
      railColor,
      durationMin: Math.max(1, leg.arrival - leg.departure),
      platformText: s.platformLabel(leg.platform, leg.track),
      transferAfter,
    });
  }

  const showDetailedSteps = !allWalk && steps.length <= 3;
  const totalWalkM = journey.legs.reduce(
    (sum, leg) => sum + (leg.mode === 'walk' ? (leg.walk ?? 0) : 0),
    0,
  );

  return (
    <View style={styles.card}>
      {/* Górny pasek tożsamości i kontekstu */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <KilometrBrandMark size={24} />
          <Text style={styles.brand}>{s.brand}</Text>
        </View>
        <View style={styles.contextPill}>
          <Text style={styles.contextText} numberOfLines={1}>
            {city.name(journey.city)} {'\u00b7'} {date}
          </Text>
        </View>
      </View>

      {/* Główny blok czasowy z proporcjonalną osią odcinków */}
      <View style={styles.heroSection}>
        <View style={styles.kpiRow}>
          <View style={styles.durationPill}>
            <Clock3 size={13} color={scheme.onSecondaryContainer} />
            <Text style={styles.durationText}>{s.duration(totalMin)}</Text>
          </View>
          <View style={styles.transfersPill}>
            <Text style={styles.transfersText}>{transfersLabel}</Text>
          </View>
        </View>

        {stacked ? (
          <View style={styles.stackedTimes}>
            <View style={styles.timeColLeft}>
              <Text style={styles.tag}>{s.departure}</Text>
              <Text style={styles.time}>{formatShareTime(journey.departure)}</Text>
            </View>
            <M3SolidArrowDown size={18} color={scheme.primary} />
            <View style={styles.timeColLeft}>
              <Text style={[styles.tag, styles.tagAccent]}>{s.arrival}</Text>
              <View style={styles.arrivalInline}>
                <Text style={[styles.time, styles.timeAccent]}>
                  {formatShareTime(journey.arrival)}
                </Text>
                {arrivalDay > 0 && <Text style={styles.day}>{s.dayLater(arrivalDay)}</Text>}
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.timesRow}>
            <View style={styles.timeColLeft}>
              <Text style={styles.tag}>{s.departure}</Text>
              <Text
                style={styles.time}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {formatShareTime(journey.departure)}
              </Text>
            </View>

            <View style={styles.arrowCol}>
              <M3SolidArrowRight size={24} width={40} color={scheme.primary} />
            </View>

            <View style={styles.timeColRight}>
              <Text style={[styles.tag, styles.tagAccent, styles.textRight]}>{s.arrival}</Text>
              <View style={styles.arrivalInline}>
                {arrivalDay > 0 && <Text style={styles.day}>{s.dayLater(arrivalDay)}</Text>}
                <Text
                  style={[styles.time, styles.timeAccent, styles.textRight]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {formatShareTime(journey.arrival)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Proporcjonalny pasek składu podróży łączący czas wyjazdu i przyjazdu */}
        <View style={styles.barRow}>
          {journey.legs.map((leg, index) => {
            const segMin = Math.max(1, leg.arrival - leg.departure);
            const isWalk = leg.mode === 'walk';
            const bg = isWalk
              ? scheme.outlineVariant
              : resolveLegBadgeColors({
                  mode: leg.mode,
                  line: leg.line,
                  compact: true,
                  cityId: journey.city,
                }).bg;
            return (
              <View
                key={index}
                style={[
                  styles.barSegment,
                  { flex: segMin, backgroundColor: bg },
                  isWalk && styles.barSegmentWalk,
                ]}
              />
            );
          })}
        </View>
      </View>

      {/* Czytelna ścieżka podróży krok po kroku */}
      <View style={styles.itineraryBox}>
        {allWalk ? (
          <>
            <View style={styles.stepRow}>
              <Text style={styles.stepTime}>{formatShareTime(journey.departure)}</Text>
              <View style={styles.railCol}>
                <View style={[styles.nodeStart, { borderColor: scheme.primary }]} />
                <View style={[styles.spineWalkDown]} />
              </View>
              <View style={styles.stepCopy}>
                <Text style={styles.endpointName} numberOfLines={2}>
                  {journey.from}
                </Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <Text style={styles.stepDur}>{s.duration(totalMin)}</Text>
              <View style={styles.railCol}>
                <View style={styles.spineWalkFull} />
              </View>
              <View style={styles.walkPillRow}>
                <Footprints size={14} color={scheme.onSecondaryContainer} />
                <Text style={styles.walkPillText}>
                  {totalWalkM > 0 ? s.walkDistance(totalWalkM) : s.walk}
                </Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <Text style={[styles.stepTime, styles.stepTimeAccent]}>
                {formatShareTime(journey.arrival)}
              </Text>
              <View style={styles.railCol}>
                <View style={styles.spineWalkUp} />
                <View style={styles.nodeEnd} />
              </View>
              <View style={styles.stepCopyLast}>
                <Text style={[styles.endpointName, styles.endpointNameDest]} numberOfLines={2}>
                  {journey.to}
                </Text>
              </View>
            </View>
          </>
        ) : showDetailedSteps ? (
          <>
            {leadingWalk && (
              <View style={styles.walkEdgeRow}>
                <Text style={styles.stepDur}>
                  {s.duration(Math.max(1, leadingWalk.arrival - leadingWalk.departure))}
                </Text>
                <View style={styles.railCol}>
                  <View style={styles.walkDotSmall} />
                  <View style={styles.spineWalkFull} />
                </View>
                <View style={styles.walkEdgeCopy}>
                  <Footprints size={12} color={scheme.onSurfaceVariant} />
                  <Text style={styles.walkEdgeText} numberOfLines={1}>
                    {leadingWalk.walk ? s.walkDistance(leadingWalk.walk) : s.walk} {'\u00b7'}{' '}
                    {journey.from}
                  </Text>
                </View>
              </View>
            )}

            {steps.map((step, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === steps.length - 1;
              return (
                <View key={idx}>
                  {/* Węzeł wsiadania (dla pierwszego odcinka; kolejne są obsłużone przez węzeł przesiadki) */}
                  {isFirst && (
                    <View style={styles.stepRow}>
                      <Text style={styles.stepTime}>{formatShareTime(step.leg.departure)}</Text>
                      <View style={styles.railCol}>
                        {leadingWalk && <View style={styles.spineWalkTopCap} />}
                        <View style={[styles.nodeStart, { borderColor: step.railColor }]} />
                        <View
                          style={[styles.spineDown, { backgroundColor: step.railColor }]}
                        />
                      </View>
                      <View style={styles.stepCopy}>
                        <Text style={styles.endpointName} numberOfLines={2}>
                          {step.leg.from}
                        </Text>
                        {step.platformText ? (
                          <View style={styles.platformChip}>
                            <Text style={styles.platformChipText} numberOfLines={1}>
                              {step.platformText}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  )}

                  {/* Środek odcinka: linia + kierunek */}
                  <View style={styles.stepRow}>
                    <Text style={styles.stepDur}>{s.duration(step.durationMin)}</Text>
                    <View style={styles.railCol}>
                      <View style={[styles.spineFull, { backgroundColor: step.railColor }]} />
                    </View>
                    <View style={styles.legLineRow}>
                      <LineBadge mode={step.leg.mode} line={step.leg.line} compact />
                      <Text style={styles.legDirection} numberOfLines={1}>
                        {step.leg.direction || step.leg.to}
                      </Text>
                    </View>
                  </View>

                  {/* Węzeł przesiadki między odcinkami */}
                  {step.transferAfter && (
                    <View style={styles.stepRow}>
                      <View style={styles.transferTimeCol}>
                        <Text style={styles.transferTime}>{step.transferAfter.arriveTime}</Text>
                        {step.transferAfter.departTime !== step.transferAfter.arriveTime && (
                          <Text style={styles.transferTimeSub}>
                            {step.transferAfter.departTime}
                          </Text>
                        )}
                      </View>
                      <View style={styles.railCol}>
                        <View style={[styles.spineHalfTop, { backgroundColor: step.railColor }]} />
                        <View style={styles.nodeTransfer} />
                        <View
                          style={[
                            styles.spineHalfBottom,
                            { backgroundColor: steps[idx + 1]?.railColor ?? scheme.outline },
                          ]}
                        />
                      </View>
                      <View style={styles.transferCopy}>
                        <Text style={styles.transferStopName} numberOfLines={2}>
                          {step.transferAfter.stopName}
                        </Text>
                        <Text style={styles.transferMeta} numberOfLines={1}>
                          {s.transferLabel}
                          {step.transferAfter.waitMin > 0
                            ? ` \u00b7 ${s.duration(step.transferAfter.waitMin)}`
                            : ''}
                          {step.transferAfter.walkM
                            ? ` \u00b7 ${s.walkDistance(step.transferAfter.walkM)}`
                            : ''}
                          {step.transferAfter.nextPlatformText
                            ? ` \u00b7 ${step.transferAfter.nextPlatformText}`
                            : ''}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* Węzeł wysiadania (ostatni odcinek) */}
                  {isLast && (
                    <View style={styles.stepRow}>
                      <Text style={[styles.stepTime, !trailingWalk && styles.stepTimeAccent]}>
                        {formatShareTime(step.leg.arrival)}
                      </Text>
                      <View style={styles.railCol}>
                        <View style={[styles.spineUp, { backgroundColor: step.railColor }]} />
                        <View
                          style={[
                            styles.nodeEnd,
                            { backgroundColor: trailingWalk ? step.railColor : scheme.primary },
                          ]}
                        />
                        {trailingWalk && <View style={styles.spineWalkDown} />}
                      </View>
                      <View style={trailingWalk ? styles.stepCopy : styles.stepCopyLast}>
                        <Text
                          style={[styles.endpointName, !trailingWalk && styles.endpointNameDest]}
                          numberOfLines={2}
                        >
                          {step.leg.to}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}

            {trailingWalk && (
              <View style={styles.walkEdgeRowEnd}>
                <Text style={[styles.stepTime, styles.stepTimeAccent]}>
                  {formatShareTime(journey.arrival)}
                </Text>
                <View style={styles.railCol}>
                  <View style={styles.spineWalkUp} />
                  <View style={styles.nodeEnd} />
                </View>
                <View style={styles.stepCopyLast}>
                  <Text style={[styles.endpointName, styles.endpointNameDest]} numberOfLines={2}>
                    {journey.to}
                  </Text>
                  <Text style={styles.walkEdgeText} numberOfLines={1}>
                    {trailingWalk.walk ? s.walkDistance(trailingWalk.walk) : s.walk} {'\u00b7'}{' '}
                    {s.duration(Math.max(1, trailingWalk.arrival - trailingWalk.departure))}
                  </Text>
                </View>
              </View>
            )}
          </>
        ) : (
          /* Skondensowany widok dla długich połączeń (> 3 odcinki tranzytowe) */
          <>
            <View style={styles.stepRow}>
              <Text style={styles.stepTime}>{formatShareTime(journey.departure)}</Text>
              <View style={styles.railCol}>
                <View style={[styles.nodeStart, { borderColor: scheme.primary }]} />
                <View style={[styles.spineDown, { backgroundColor: scheme.outlineVariant }]} />
              </View>
              <View style={styles.stepCopy}>
                <Text style={styles.endpointName} numberOfLines={2}>
                  {journey.from}
                </Text>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepTimeSpacer} />
              <View style={styles.railCol}>
                <View style={[styles.spineFull, { backgroundColor: scheme.outlineVariant }]} />
              </View>
              <View style={styles.compactLines}>
                {transitLegs.map((leg, index) => (
                  <View key={index} style={styles.compactLineStep}>
                    {index > 0 && <ArrowRight size={11} color={scheme.onSurfaceVariant} />}
                    <LineBadge mode={leg.mode} line={leg.line} compact />
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.stepRow}>
              <Text style={[styles.stepTime, styles.stepTimeAccent]}>
                {formatShareTime(journey.arrival)}
              </Text>
              <View style={styles.railCol}>
                <View style={[styles.spineUp, { backgroundColor: scheme.outlineVariant }]} />
                <View style={styles.nodeEnd} />
              </View>
              <View style={styles.stepCopyLast}>
                <Text style={[styles.endpointName, styles.endpointNameDest]} numberOfLines={2}>
                  {journey.to}
                </Text>
              </View>
            </View>
          </>
        )}
      </View>

      {/* Dyskretna stopka grafiki */}
      <View style={styles.footer}>
        <Text style={styles.footerDomain}>kilometr.app</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: shape.extraLarge,
    overflow: 'hidden',
    backgroundColor: scheme.surfaceContainer,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
    padding: 18,
    gap: 14,
    ...elev.level1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  brand: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
    letterSpacing: -0.25,
    color: scheme.onSurface,
  },
  contextPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    flexShrink: 1,
  },
  contextText: {
    ...type.labelSmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  heroSection: {
    gap: 10,
  },
  kpiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: scheme.secondaryContainer,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  durationText: {
    ...type.labelMedium,
    fontWeight: '800',
    color: scheme.onSecondaryContainer,
    fontVariant: ['tabular-nums'],
  },
  transfersPill: {
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: shape.full,
  },
  transfersText: {
    ...type.labelSmall,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
  },
  timesRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  stackedTimes: {
    gap: 8,
  },
  timeColLeft: {
    alignItems: 'flex-start',
    gap: 2,
    flexShrink: 1,
  },
  timeColRight: {
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 1,
  },
  arrowCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
    minWidth: 36,
  },
  tag: {
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: scheme.onSurfaceVariant,
  },
  tagAccent: {
    color: scheme.primary,
  },
  textRight: {
    textAlign: 'right',
  },
  time: {
    fontSize: 38,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -1.4,
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  timeAccent: {
    color: scheme.primary,
  },
  arrivalInline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  day: {
    ...type.labelMedium,
    fontWeight: '800',
    color: scheme.primary,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 6,
    marginTop: 2,
  },
  barSegment: {
    height: 6,
    borderRadius: shape.full,
    minWidth: 10,
  },
  barSegmentWalk: {
    opacity: 0.55,
  },
  itineraryBox: {
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  stepTime: {
    width: 46,
    textAlign: 'right',
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '800',
    color: scheme.onSurface,
    fontVariant: ['tabular-nums'],
  },
  stepTimeAccent: {
    color: scheme.primary,
  },
  stepTimeSpacer: {
    width: 46,
  },
  stepDur: {
    width: 46,
    textAlign: 'right',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
    paddingTop: 5,
  },
  transferTimeCol: {
    width: 46,
    alignItems: 'flex-end',
    paddingVertical: 4,
  },
  transferTime: {
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onSurfaceVariant,
    fontVariant: ['tabular-nums'],
  },
  transferTimeSub: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    color: scheme.outline,
    fontVariant: ['tabular-nums'],
  },
  railCol: {
    width: 18,
    alignItems: 'center',
    flexShrink: 0,
  },
  nodeStart: {
    width: 11,
    height: 11,
    borderRadius: shape.full,
    borderWidth: 2.5,
    backgroundColor: scheme.surfaceContainerLow,
    marginTop: 4,
    zIndex: 2,
  },
  nodeEnd: {
    width: 11,
    height: 11,
    borderRadius: shape.full,
    backgroundColor: scheme.primary,
    marginTop: 4,
    zIndex: 2,
  },
  nodeTransfer: {
    width: 9,
    height: 9,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: 2,
    borderColor: scheme.onSurfaceVariant,
    zIndex: 2,
  },
  spineDown: {
    position: 'absolute',
    top: 15,
    bottom: 0,
    width: 3,
  },
  spineFull: {
    flex: 1,
    width: 3,
    minHeight: 10,
  },
  spineUp: {
    position: 'absolute',
    top: 0,
    height: 8,
    width: 3,
  },
  spineHalfTop: {
    height: 7,
    width: 3,
  },
  spineHalfBottom: {
    flex: 1,
    width: 3,
    minHeight: 8,
  },
  spineWalkTopCap: {
    position: 'absolute',
    top: 0,
    height: 5,
    width: 2,
    backgroundColor: scheme.outlineVariant,
  },
  spineWalkDown: {
    position: 'absolute',
    top: 15,
    bottom: 0,
    width: 2,
    backgroundColor: scheme.outlineVariant,
  },
  spineWalkFull: {
    flex: 1,
    width: 2,
    minHeight: 10,
    backgroundColor: scheme.outlineVariant,
  },
  spineWalkUp: {
    position: 'absolute',
    top: 0,
    height: 8,
    width: 2,
    backgroundColor: scheme.outlineVariant,
  },
  stepCopy: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 8,
    gap: 4,
  },
  stepCopyLast: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  endpointName: {
    fontSize: 14.5,
    lineHeight: 19,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  endpointNameDest: {
    fontWeight: '800',
  },
  platformChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: scheme.secondaryContainer,
  },
  platformChipText: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '700',
    color: scheme.onSecondaryContainer,
  },
  legLineRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 10,
  },
  legDirection: {
    flex: 1,
    minWidth: 0,
    ...type.bodySmall,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  transferCopy: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 4,
    paddingBottom: 10,
    gap: 2,
  },
  transferStopName: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '700',
    color: scheme.onSurface,
  },
  transferMeta: {
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '500',
    color: scheme.onSurfaceVariant,
  },
  walkPillRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingBottom: 10,
  },
  walkPillText: {
    ...type.bodySmall,
    fontWeight: '600',
    color: scheme.onSurfaceVariant,
  },
  walkEdgeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  walkEdgeRowEnd: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  walkDotSmall: {
    width: 6,
    height: 6,
    borderRadius: shape.full,
    backgroundColor: scheme.outline,
    marginTop: 5,
  },
  walkEdgeCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingBottom: 10,
  },
  walkEdgeText: {
    fontSize: 11.5,
    lineHeight: 15,
    color: scheme.onSurfaceVariant,
    flexShrink: 1,
  },
  compactLines: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingBottom: 12,
  },
  compactLineStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 2,
  },
  footerDomain: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: scheme.outline,
  },
});
