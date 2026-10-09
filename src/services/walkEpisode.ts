/**
 * Maszyna stanów jednego dojścia pieszego (czysta, bez `expo-*`).
 *
 * Zasada: krótki postój zostaje w próbce (światła, przejście dla pieszych),
 * długi przerywa dojście i zapisuje to, co było do tej pory. Po sklepie,
 * na rozmowie albo po odejściu w bok dojście do przystanku zaczyna się od
 * nowa i też zapisuje się jako osobna próbka. Bez tego jedna wizyta w sklepie
 * psuła tempo całej okolicy: 800 m i 15 minut postoju to 0,53 m/s, czyli
 * przejście walidacji, a realny chód to ok. 1,4 m/s.
 *
 * Wszystko zwraca próbkę synchronicznie, więc rozcięcie epizodu nie wygrywa
 * wyścigu z zapisem i nie trzeba tu żadnych obietnic ani stanów przejściowych.
 */

export interface WalkFix {
  lat: number;
  lon: number;
  /** Znacznik czasu fixu, ms. */
  ts: number;
  accuracyM: number | null;
  speedMps: number | null;
  mocked: boolean;
}

export interface WalkSampleOut {
  originLat: number;
  originLon: number;
  dest: string | null;
  speedMps: number;
  distanceM: number;
  durationSec: number;
}

const ACCURACY_GATE_M = 25;
/** Ruch poniżej tej wartości to szum GPS, a nie spacer. */
const NOISE_GATE_M = 3;
/** Powyżej tej prędkości w pojedynczym kroku to skok fixu albo pojazd. */
const MAX_STEP_MPS = 3.5;
/** Prędkość z systemu, powyżej której jedziemy, a nie idziemy. */
const VEHICLE_SPEED_MPS = 4.0;
/** Po tym bezruchu dojście się zrywa: światła nie trwają tak długo. */
export const STALL_SPLIT_SEC = 90;
/** Dłuższe dojście to już obchód, nie droga na przystanek. */
export const MAX_EPISODE_SEC = 900;
/** Jaka część epizodu musi być ruchem. Dojdzie bez udziału ruchu to postój. */
export const MIN_MOVING_SHARE = 0.4;
/**
 * Stosunek dystansu w linii prostej do przebytej drogi. Dojście na
 * przystanek jest w miarę proste, a dryf GPS stojącego telefonu to 2–3 m
 * w tę i z powrotem: metry rośną, a przesunięcie zostaje w miejscu. Bez tego
 * sprawdzenia siedzenie pod domem dawałoby pozorne 1,3 m/s i trafiałoby do
 * statystyk. Piesi z psem, zakupy i objazdy schodzą poniżej 0,55.
 */
const MIN_NET_RATIO = 0.55;
const MIN_DISTANCE_M = 40;
const MIN_DURATION_SEC = 30;
const MIN_FIXES = 4;
const MIN_EFFECTIVE_MPS = 0.4;
const MAX_EFFECTIVE_MPS = 2.8;

interface Episode {
  originLat: number;
  originLon: number;
  dest: string | null;
  startTs: number;
  /** Kiedy zaczęliśmy realnie iść. Czas przed tym (staniecie, sklep) nie jest dojściem. */
  movingStartTs: number | null;
  startLat: number;
  startLon: number;
  lastLat: number;
  lastLon: number;
  lastTs: number;
  distanceM: number;
  movingSec: number;
  stallSince: number | null;
  fixes: number;
}

export interface WalkEpisodeMachine {
  /** Faza „idę”: otwiera dojście albo domyka poprzednie przy zmianie celu. */
  begin(dest: string | null, originLat: number, originLon: number): WalkSampleOut | null;
  /** Nowy fix GPS. Zwraca próbkę, gdy dojście właśnie się domknęło. */
  feed(fix: WalkFix, inVehicle: boolean): WalkSampleOut | null;
  /** Koniec dojścia (zmiana fazy albo rezygnacja użytkownika). */
  end(): WalkSampleOut | null;
}

export function createWalkEpisodeMachine(nowMs: number): WalkEpisodeMachine {
  let ep: Episode | null = null;
  let lastFix: { lat: number; lon: number } | null = null;
  let clock = nowMs;

  function open(originLat: number, originLon: number, dest: string | null): void {
    const pos = lastFix ?? { lat: originLat, lon: originLon };
    ep = {
      originLat: originLat,
      originLon: originLon,
      dest,
      startTs: clock,
      movingStartTs: null,
      startLat: pos.lat,
      startLon: pos.lon,
      lastLat: pos.lat,
      lastLon: pos.lon,
      lastTs: clock,
      distanceM: 0,
      movingSec: 0,
      stallSince: null,
      fixes: 0,
    };
  }

  /** Próbkę dostajemy tylko z dojścia, które faktycznie wyglądało na spacer. */
  function close(): WalkSampleOut | null {
    const cur = ep;
    ep = null;
    if (!cur) return null;
    // Mierzymy od pierwszego kroku do ostatniego, bez staniacia na początku
    // (sklep przed startem) i bez postoju na końcu (światła tuż przed
    // przystankiem też wchodzą, ale dopiero po ostatnim kroku, więc zostają
    // w oknie i to jest właśnie tempo efektywne, o które chodzi).
    const from = cur.movingStartTs ?? cur.startTs;
    const trailingStall = cur.stallSince != null ? Math.max(0, (cur.lastTs - cur.stallSince) / 1000) : 0;
    const durationSec = Math.round((cur.lastTs - from) / 1000 - trailingStall);
    if (cur.fixes < MIN_FIXES || cur.distanceM < MIN_DISTANCE_M || durationSec < MIN_DURATION_SEC) return null;
    if (cur.movingSec < durationSec * MIN_MOVING_SHARE) return null;
    const netM = haversineM(cur.startLat, cur.startLon, cur.lastLat, cur.lastLon);
    if (netM < MIN_DISTANCE_M || netM < cur.distanceM * MIN_NET_RATIO) return null;
    const effective = cur.distanceM / durationSec;
    if (effective < MIN_EFFECTIVE_MPS || effective > MAX_EFFECTIVE_MPS) return null;
    return {
      originLat: cur.originLat,
      originLon: cur.originLon,
      dest: cur.dest,
      speedMps: effective,
      distanceM: Math.round(cur.distanceM),
      durationSec,
    };
  }

  /**
   * Domknięcie dojścia i otwarcie następnego do tego samego celu. Start i cel
   * dziedziczymy, bo o nie pyta planer; pozycja startu biegnie z miejsca,
   * w którym user faktycznie ruszył po sklepie.
   */
  function split(): WalkSampleOut | null {
    const cur = ep;
    if (!cur) return null;
    const sample = close();
    open(cur.originLat, cur.originLon, cur.dest);
    return sample;
  }

  return {
    begin(dest, originLat, originLon) {
      if (ep) {
        if (ep.dest === dest) return null;
        // Inny przystanek oznacza inne dojście (przesiadka albo zmiana zdania
        // w trakcie). Start dziedziczymy, bo o nim pyta planer, ale cel bierze
        // nowy, inaczej dojście na przesiadce zapisałoby się jako dojście do
        // poprzedniego przystanku.
        const { originLat: fromLat, originLon: fromLon } = ep;
        const sample = close();
        open(fromLat, fromLon, dest);
        return sample;
      }
      open(originLat, originLon, dest);
      return null;
    },

    feed(fix, inVehicle) {
      if (fix.mocked) return null;
      if (fix.accuracyM != null && fix.accuracyM > ACCURACY_GATE_M) return null;
      lastFix = { lat: fix.lat, lon: fix.lon };
      clock = fix.ts;
      if (!ep || inVehicle) return null;

      const sync = () => {
        ep!.lastLat = fix.lat;
        ep!.lastLon = fix.lon;
        ep!.lastTs = fix.ts;
      };

      if (fix.speedMps != null && fix.speedMps > VEHICLE_SPEED_MPS) {
        sync();
        return null;
      }

      const stepSec = (fix.ts - ep.lastTs) / 1000;
      // Dziura w fixach (tunel, winda, garaż) to nie ruch: krótka mieści się w
      // dojściu, długa zrywa epizod.
      if (stepSec > STALL_SPLIT_SEC) return split();
      if (stepSec <= 0) return null;

      const stepM = haversineM(ep.lastLat, ep.lastLon, fix.lat, fix.lon);

      if (stepM < NOISE_GATE_M) {
        // Stoimy: światła albo sklep. Czas leci, metry nie.
        if (ep.stallSince === null) ep.stallSince = fix.ts;
        ep.fixes += 1;
        ep.lastTs = fix.ts;
        if ((fix.ts - ep.stallSince) / 1000 >= STALL_SPLIT_SEC) return split();
        return null;
      }

      if (stepM / stepSec > MAX_STEP_MPS) {
        sync();
        return null;
      }

      if (ep.movingStartTs === null) ep.movingStartTs = fix.ts - stepSec * 1000;
      ep.distanceM += stepM;
      ep.movingSec += stepSec;
      ep.stallSince = null;
      sync();
      ep.fixes += 1;

      if (fix.ts - (ep.movingStartTs ?? ep.startTs) >= MAX_EPISODE_SEC * 1000) return split();
      return null;
    },

    end() {
      return close();
    },
  };
}

/** Odległość ortodromiczna w metrach. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
