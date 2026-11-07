import { ConnectionLineAlerts } from './ConnectionLineAlerts';
import type { Connection } from '../types/models';

/**
 * @deprecated Alerty kolejowe zostały zintegrowane bezpośrednio w sekcji
 * "Zmiany na Twoich liniach" (<ConnectionLineAlerts />) z LineBadge, M3 Expressive i rozwiązaniami.
 */
export function RailTripAlerts({ connection }: { connection: Connection }) {
  return <ConnectionLineAlerts connection={connection} />;
}
