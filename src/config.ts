import Constants from 'expo-constants';

function extractHost(candidate?: string | null): string | null {
  if (!candidate) return null;
  const match = candidate.match(/(?:(?:exp|http|https):\/\/)?([^:/]+)/i);
  const host = match ? match[1] : candidate.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    return host;
  }
  return null;
}

function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // When running in Expo Go or dev build over Wi-Fi, extract workstation LAN IP from various properties
  const c = Constants as any;
  const candidates = [
    Constants.expoConfig?.hostUri,
    c.expoGoConfig?.debuggerHost,
    c.manifest?.debuggerHost,
    c.manifest2?.extra?.expoGo?.debuggerHost,
    c.experienceUrl,
    c.linkingUri,
  ];

  for (const cand of candidates) {
    const host = extractHost(cand);
    if (host) {
      return `http://${host}:3000`;
    }
  }

  // Over ADB USB with `adb reverse tcp:3000 tcp:3000`, 127.0.0.1 connects directly to workstation backend
  return 'http://127.0.0.1:3000';
}

export const API_URL = getApiUrl();

// Neutralny placeholder zanim GPS zwróci pozycję (prawdziwe współrzędne
// centrum Wrocławia, nie mock danych). Nadpisywany przez LocationService.
export const DEFAULT_LOCATION = {
  title: 'Twoja lokalizacja',
  address: 'Wrocław',
  lat: 51.1079,
  lon: 17.0385,
};
