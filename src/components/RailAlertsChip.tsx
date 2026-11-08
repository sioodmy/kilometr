import { useEffect, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { TriangleAlert } from "./icons";
import { useStrings } from "../i18n";
import { scheme, shape } from "../theme/tokens";
import type { Connection } from "../types/models";
import { alertsForConnection, type TrainAlerts } from "../services/railTripAlerts";
import { linesFromConnections } from "../services/recentRouteLines";
import { getCachedNews } from "../services/mpkNews";
import { alertTouchesRoute } from "./ConnectionLineAlerts";

/**
 * Kompaktowy wskaźnik utrudnień w stylu Material 3 Expressive na karcie połączenia.
 * Wyświetla subtelną ikonę ostrzeżenia w nagłówku, gdy na trasie (kolej lub zbiorkom)
 * występują utrudnienia. Szczegóły pasażer sprawdza na ekranie trasy.
 */
export function ConnectionDisruptionBadge({
  connection,
  dimmed,
}: {
  connection: Connection;
  dimmed?: boolean;
}) {
  const s = useStrings();
  const [trainAlerts, setTrainAlerts] = useState<TrainAlerts[]>([]);

  const hasTrain = useMemo(
    () =>
      connection.legs?.some(
        (l) => l.mode === "train" || l.tripId?.startsWith("pl:") || l.trainNumber,
      ),
    [connection.legs],
  );

  useEffect(() => {
    if (!hasTrain) return;
    let alive = true;
    void alertsForConnection(connection).then((alerts) => {
      if (alive) setTrainAlerts(alerts);
    });
    return () => {
      alive = false;
    };
  }, [connection, hasTrain]);

  const hasTrainDisruptions = useMemo(
    () => trainAlerts.some((ta) => ta.alerts.length > 0),
    [trainAlerts],
  );

  const routeLines = useMemo(() => linesFromConnections([connection]), [connection]);
  const lineSet = useMemo(
    () => new Set(routeLines.map((l) => l.trim().toUpperCase())),
    [routeLines],
  );

  const cityDisruptions = useMemo(() => {
    if (lineSet.size === 0) return [];
    const cached = getCachedNews() ?? [];
    return cached.filter((item) => alertTouchesRoute(item, lineSet));
  }, [lineSet]);

  const hasCityDisruptions = cityDisruptions.length > 0;

  const isUrgent = useMemo(() => {
    const urgentTrain = trainAlerts.some((ta) => ta.alerts.some((a) => a.isUrgent));
    const urgentCity = cityDisruptions.some(
      (item) => item.urgent || item.disruption?.severity === "blocking",
    );
    return urgentTrain || urgentCity;
  }, [trainAlerts, cityDisruptions]);

  if (!hasTrainDisruptions && !hasCityDisruptions) {
    return null;
  }

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(150)}
      style={[
        styles.badge,
        isUrgent ? styles.badgeUrgent : styles.badgeWarning,
        dimmed && styles.dimmed,
      ]}
      pointerEvents="none"
      accessibilityRole="image"
      accessibilityLabel={s.railAlerts.disruptionsBadgeA11y}
    >
      <TriangleAlert
        size={15}
        color={isUrgent ? scheme.error : scheme.warning}
      />
    </Animated.View>
  );
}

export const RailAlertsChip = ConnectionDisruptionBadge;

const styles = StyleSheet.create({
  badge: {
    width: 28,
    height: 28,
    borderRadius: shape.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  badgeWarning: {
    backgroundColor: scheme.warning + "24",
    borderColor: scheme.warning + "44",
  },
  badgeUrgent: {
    backgroundColor: scheme.error + "24",
    borderColor: scheme.error + "44",
  },
  dimmed: {
    opacity: 0.6,
  },
});
