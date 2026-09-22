export type SuggestionKind = 'stop' | 'address' | 'place' | 'history';

export interface Suggestion {
  id: string;
  title: string;
  address: string;
  kind: SuggestionKind;
  category?: string;
  lat: number;
  lon: number;
  distanceM?: number;
  weight?: number;
}
