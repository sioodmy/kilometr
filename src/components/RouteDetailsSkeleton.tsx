import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonBone, SkeletonPulse } from './SkeletonPulse';
import { elev, scheme, shape } from '../theme/tokens';
import type { Connection } from '../types/models';

const CARD_PAD_H = 14;
const TIME_COL_W = 54;
const RAIL_COL_W = 28;
const COL_GAP = 8;
const SPINE_W = 3;

/** Lekka makieta karty pojedynczego odcinka przejazdu (zgodna z 3-kolumnową osią czasu). */
export const LegCardSkeleton = memo(function LegCardSkeleton({
  withAmenities = false,
}: {
  withAmenities?: boolean;
}) {
  return (
    <View style={styles.legCard}>
      <SkeletonPulse style={styles.legCardPulse}>
        <View style={styles.gridRow}>
          <View style={styles.timeCol}>
            <SkeletonBone width={44} height={18} radius={6} />
          </View>
          <View style={styles.railCol}>
            <View style={styles.nodeRing} />
            <View style={styles.departureSpine} />
          </View>
          <View style={styles.departureCol}>
            <SkeletonBone width="68%" height={18} radius={6} />
            <SkeletonBone width={76} height={18} radius={shape.small} tone="subtle" />
          </View>
        </View>

        <View style={styles.gridRow}>
          <View style={styles.durationCol}>
            <SkeletonBone width={34} height={12} radius={5} tone="subtle" />
          </View>
          <View style={styles.railCol}>
            <View style={styles.railContinuous} />
          </View>
          <View style={styles.bodyCol}>
            <View style={styles.mockLineCard}>
              <View style={styles.mockLineHeader}>
                <SkeletonBone width={44} height={24} radius={8} />
                <View style={styles.mockLineTextCol}>
                  <SkeletonBone width="72%" height={14} radius={6} />
                  <SkeletonBone width="44%" height={11} radius={5} tone="subtle" />
                </View>
              </View>
              {withAmenities ? (
                <View style={styles.mockAmenitiesTray}>
                  <View style={styles.mockAmenityHeader}>
                    <SkeletonBone width={13} height={13} radius={4} />
                    <SkeletonBone width={118} height={11} radius={5} />
                  </View>
                  <View style={styles.mockChipsRow}>
                    <SkeletonBone width={76} height={22} radius={shape.small} />
                    <SkeletonBone width={90} height={22} radius={shape.small} />
                    <SkeletonBone width={62} height={22} radius={shape.small} />
                  </View>
                </View>
              ) : null}
            </View>
            <SkeletonBone width="52%" height={34} radius={12} tone="subtle" />
          </View>
        </View>

        <View style={styles.gridRow}>
          <View style={styles.timeCol}>
            <SkeletonBone width={44} height={18} radius={6} />
          </View>
          <View style={styles.railCol}>
            <View style={styles.arrivalSpine} />
            <View style={styles.nodeFilled} />
          </View>
          <View style={styles.arrivalCol}>
            <SkeletonBone width="62%" height={18} radius={6} />
          </View>
        </View>
      </SkeletonPulse>
    </View>
  );
});

/** Lekka makieta łącznika pieszego lub przesiadki między odcinkami. */
export const ConnectorSkeleton = memo(function ConnectorSkeleton() {
  return (
    <SkeletonPulse style={styles.connectorRow}>
      <View style={styles.timeCol}>
        <SkeletonBone width={36} height={12} radius={5} tone="subtle" />
      </View>
      <View style={styles.railCol}>
        <View style={styles.connectorTick} />
        <SkeletonBone width={22} height={22} radius={shape.full} />
        <View style={styles.connectorTick} />
      </View>
      <View style={styles.connectorContent}>
        <SkeletonBone width="48%" height={13} radius={5} />
        <SkeletonBone width="34%" height={11} radius={5} tone="subtle" />
      </View>
    </SkeletonPulse>
  );
});

/** Lekka makieta karty mapy przed jej docelowym montażem po animacji otwarcia. */
export const MapCardSkeleton = memo(function MapCardSkeleton() {
  return (
    <View style={styles.mapCard}>
      <SkeletonPulse style={styles.mapCardInner}>
        <View style={styles.mapHeader}>
          <SkeletonBone width={40} height={40} radius={14} />
          <View style={styles.mapHeaderCol}>
            <SkeletonBone width={86} height={15} radius={6} />
            <SkeletonBone width={142} height={12} radius={5} tone="subtle" />
          </View>
          <SkeletonBone width={92} height={36} radius={shape.full} />
        </View>
        <View style={styles.mapCanvas}>
          <SkeletonBone width={48} height={48} radius={16} />
          <SkeletonBone width={164} height={14} radius={6} tone="subtle" />
        </View>
      </SkeletonPulse>
    </View>
  );
});

/**
 * Szkielet sekcji szczegółów połączenia pokazywany w trakcie animacji wejścia
 * ekranu, zanim zamontują się karty osi czasu i sekcje poniżej zgięcia.
 */
export const RouteDetailsSkeleton = memo(function RouteDetailsSkeleton({
  connection,
  showDeckPlaceholder = false,
}: {
  connection: Connection;
  showDeckPlaceholder?: boolean;
}) {
  const transitLegs = connection.legs.filter((l) => l.mode !== 'walk');
  const firstHasTrain = transitLegs[0]?.mode === 'train';
  const showSecond = transitLegs.length > 1;

  return (
    <View style={styles.container}>
      {showDeckPlaceholder ? (
        <SkeletonPulse style={styles.deckRow}>
          <View style={styles.deckCard}>
            <SkeletonBone width={36} height={36} radius={12} />
            <View style={styles.deckTextCol}>
              <SkeletonBone width="64%" height={14} radius={6} />
              <SkeletonBone width="46%" height={11} radius={5} tone="subtle" />
            </View>
          </View>
        </SkeletonPulse>
      ) : null}

      <LegCardSkeleton withAmenities={firstHasTrain} />
      {showSecond ? (
        <>
          <ConnectorSkeleton />
          <LegCardSkeleton withAmenities={transitLegs[1]?.mode === 'train'} />
        </>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  deckRow: {
    width: '100%',
  },
  deckCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainer,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    ...elev.level1,
  },
  deckTextCol: {
    flex: 1,
    gap: 6,
  },
  legCard: {
    width: '100%',
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    paddingHorizontal: CARD_PAD_H,
    paddingVertical: 16,
    ...elev.level1,
  },
  legCardPulse: {
    width: '100%',
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: COL_GAP,
  },
  timeCol: {
    width: TIME_COL_W,
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexShrink: 0,
  },
  durationCol: {
    width: TIME_COL_W,
    alignItems: 'flex-end',
    paddingTop: 16,
    flexShrink: 0,
  },
  railCol: {
    width: RAIL_COL_W,
    alignItems: 'center',
    flexShrink: 0,
  },
  nodeRing: {
    width: 12,
    height: 12,
    borderRadius: shape.full,
    borderWidth: 2.5,
    borderColor: scheme.surfaceContainerHighest,
    backgroundColor: scheme.surfaceContainer,
    marginTop: 5,
    zIndex: 2,
  },
  nodeFilled: {
    width: 12,
    height: 12,
    borderRadius: shape.full,
    backgroundColor: scheme.surfaceContainerHighest,
    marginTop: 5,
    zIndex: 2,
  },
  departureSpine: {
    position: 'absolute',
    top: 17,
    bottom: 0,
    width: SPINE_W,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  arrivalSpine: {
    position: 'absolute',
    top: 0,
    height: 11,
    width: SPINE_W,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  railContinuous: {
    flex: 1,
    width: SPINE_W,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  departureCol: {
    flex: 1,
    minWidth: 0,
    gap: 7,
    paddingBottom: 12,
  },
  bodyCol: {
    flex: 1,
    minWidth: 0,
    gap: 8,
    paddingBottom: 10,
  },
  arrivalCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  mockLineCard: {
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    padding: 10,
    gap: 8,
  },
  mockLineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mockLineTextCol: {
    flex: 1,
    gap: 5,
  },
  mockAmenitiesTray: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.medium,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 7,
  },
  mockAmenityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mockChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  connectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: COL_GAP,
    paddingHorizontal: CARD_PAD_H,
    paddingVertical: 6,
  },
  connectorTick: {
    width: 2,
    height: 8,
    borderRadius: 1,
    backgroundColor: scheme.surfaceContainerHighest,
  },
  connectorContent: {
    flex: 1,
    gap: 5,
  },
  mapCard: {
    backgroundColor: scheme.surfaceContainer,
    borderRadius: shape.extraLarge,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    padding: 14,
    ...elev.level1,
  },
  mapCardInner: {
    gap: 12,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mapHeaderCol: {
    flex: 1,
    gap: 5,
  },
  mapCanvas: {
    height: 256,
    borderRadius: 22,
    backgroundColor: scheme.surfaceContainerLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: scheme.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
});
