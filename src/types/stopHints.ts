export type StopHintValue =
  | string
  | {
      name?: string;
      code?: string;
      platform?: string;
      hint: string;
    };

export interface StopHintsDataset {
  schemaVersion: number;
  city: string;
  generatedAt: string;
  /**
   * Mapa kodu słupka (np. "20820") lub stop_id bezpośrednio na 1-zdaniową wskazówkę tekstową.
   */
  stops: Record<string, StopHintValue>;
  /**
   * Mapa znormalizowanej nazwy zespołu (np. "pl_grunwaldzki") na 1-zdaniową wskazówkę węzła.
   */
  clusters: Record<string, string>;
}
