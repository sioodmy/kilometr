// Centralny key-value store aplikacji.
//
// Powód: @react-native-async-storage/async-storage crashuje natywnie na starcie
// (FATAL EXCEPTION w AsyncTask: SQLiteCantOpenDatabaseException dla RKStorage,
// gdy katalog databases nie istnieje — zaobserwowane na Pixel 7a / GrapheneOS).
// JS-owy try/catch tego nie łapie, bo wybucha wątek natywny.
//
// Zamiennik: expo-sqlite/kv-store — ten sam asynchroniczny interfejs
// (getItem/setItem/removeItem), ale backend w expo-sqlite, które poprawnie
// tworzy katalogi. Wymaga pluginu "expo-sqlite" w app.json (jest).
//
// Uwaga migracyjna: stare dane z AsyncStorage nie są przenoszone — to tylko
// cache (sugestie/recent/trasy) i ustawienia (wrócą do defaultów raz).

import Storage from 'expo-sqlite/kv-store';

export async function kvGet(key: string): Promise<string | null> {
  try {
    return await Storage.getItem(key);
  } catch (err) {
    console.warn('[Storage] getItem failed:', err);
    return null;
  }
}

export async function kvSet(key: string, value: string): Promise<void> {
  try {
    await Storage.setItem(key, value);
  } catch (err) {
    console.warn('[Storage] setItem failed:', err);
  }
}

export async function kvRemove(key: string): Promise<void> {
  try {
    await Storage.removeItem(key);
  } catch (err) {
    console.warn('[Storage] removeItem failed:', err);
  }
}
