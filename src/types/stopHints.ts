export type StopHintValue =
  | string
  | {
      name?: string;
      code?: string;
      platform?: string;
      hint: string;
    };

export interface MetroEntrance {
  /** GTFS stop_id wejścia, np. "1003M:E1" */
  id: string;
  /** Numer lub oznaczenie wejścia, np. "1", "2 (Winda)", "1·2·3" */
  num: string;
  /** GTFS parent_station (ID stacji), np. "1003M" */
  stationId: string;
  lat: number;
  lon: number;
  /** Czy wejście ma windę / dostęp bez barier */
  wheelchair?: boolean;
  /** Krótka 1-zdaniowa wskazówka lokalizacji wejścia */
  hint: string;
}

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
  /**
   * Wejścia do stacji metra (Warszawa M1/M2) z lokalizacją i opisem.
   */
  metroEntrances?: MetroEntrance[];
}
