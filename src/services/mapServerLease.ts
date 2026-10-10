import { startMapServer, stopMapServer } from '../../modules/kilometr-maps';

export interface MapServerLease {
  base: string | null;
  release: () => void;
}

let leases = 0;
let baseUrl: string | null = null;
let startPromise: Promise<string | null> | null = null;
let stopPromise: Promise<void> | null = null;

export async function acquireMapServer(): Promise<MapServerLease> {
  leases += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    leases = Math.max(0, leases - 1);
    if (leases === 0) {
      baseUrl = null;
      stopPromise = stopMapServer().finally(() => {
        stopPromise = null;
      });
    }
  };

  try {
    if (stopPromise) await stopPromise;
    if (!baseUrl) {
      if (!startPromise) {
        const pending = startMapServer();
        startPromise = pending;
        void pending.finally(() => {
          if (startPromise === pending) startPromise = null;
        });
      }
      baseUrl = await startPromise;
    }
    if (!baseUrl) {
      release();
      return { base: null, release: () => undefined };
    }
    return { base: baseUrl, release };
  } catch {
    release();
    return { base: null, release: () => undefined };
  }
}
