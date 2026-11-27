import { memo, startTransition, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { TriangleAlert } from "./icons";
import { useStrings } from "../i18n";
import { scheme, shape } from "../theme/tokens";
import type { Connection } from "../types/models";
import {
  alertsForConnection,
  getCachedAlertsForConnection,
  type TrainAlerts,
} from "../services/railTripAlerts";
import { linesFromConnections } from "../services/recentRouteLines";
import { useActiveCity } from "../services/cityStore";
import { getCachedNews, subscribeNewsCache } from "../services/mpkNews";
import { alertTouchesRoute } from "./ConnectionLineAlerts";
import { waitForUiScrollIdle } from "../services/routing/yieldFrame";

/**
 * Kompaktowy wskaźnik utrudnień w stylu Material 3 Expressive na karcie połączenia.
 * Wyświetla subtelną ikonę ostrzeżenia w nagłówku, gdy na trasie (kolej lub zbiorkom)
 * występują utrudnienia. Szczegóły pasażer sprawdza na ekranie trasy.
 */
export const RailAlertsChip = memo(function RailAlertsChip({
  connection,
  dimmed,
}: {
  connection: Connection;
  dimmed?: boolean;
}) {
  const s = useStrings();
  const { cityId } = useActiveCity();
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  const trainAlertKey = useMemo(
    () =>
      connection.legs
        ?.filter((l) => l.mode === "train" || l.tripId?.startsWith("pl:") || l.trainNumber)
        .map((l) => `${l.tripId ?? ""}:${l.trainNumber ?? ""}:${l.line ?? ""}`)
        .join(";") ?? "",
    [connection.legs],
  );

  const [trainAlerts, setTrainAlerts] = useState<TrainAlerts[]>(
    () => getCachedAlertsForConnection(connection) ?? [],
  );
  const [newsTick, setNewsTick] = useState(0);

  useEffect(() => {
    if (!trainAlertKey) {
      setTrainAlerts((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const cached = getCachedAlertsForConnection(connectionRef.current);
    if (cached) {
      setTrainAlerts(cached);
      return;
    }
    let alive = true;
    void alertsForConnection(connectionRef.current).then(async (alerts) => {
      await waitForUiScrollIdle(450);
      if (!alive) return;
      startTransition(() => {
        setTrainAlerts(alerts);
      });
    });
    return () => {
      alive = false;
    };
  }, [trainAlertKey]);

  useEffect(() => subscribeNewsCache(() => setNewsTick((n) => n + 1)), []);

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
    // newsTick i cityId: odśwież gdy cache albo aktywne miasto się zmieni
  }, [lineSet, newsTick, cityId]);

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
    <View
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
    </View>
  );
});

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
