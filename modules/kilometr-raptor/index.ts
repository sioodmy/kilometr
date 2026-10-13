import { RAPTOR_WASM_BASE64 } from "./wasmBase64";

const STATUS_NET_MISSING = -1;

type NativeKilometrRaptorModule = {
  isAvailable(): boolean;
  hasNetworkSync(netId: number): boolean;
  loadNetworkSync(netId: number, packedNet: Uint8Array): boolean;
  dropNetworkSync(netId: number): void;
  clearNetworksSync(): void;
  runQuerySync(packedQuery: Uint8Array): Uint8Array | null;
  hasNetwork(netId: number): Promise<boolean>;
  loadNetwork(netId: number, packedNet: Uint8Array): Promise<boolean>;
  dropNetwork(netId: number): Promise<void>;
  clearNetworks(): Promise<void>;
  runQuery(packedQuery: Uint8Array): Promise<Uint8Array | null>;
};

type WasmExports = {
  memory: WebAssembly.Memory;
  raptor_alloc(size: number): number;
  raptor_dealloc(ptr: number, size: number): void;
  raptor_has_network(netId: number): number;
  raptor_load_network(netId: number, ptr: number, len: number): number;
  raptor_drop_network(netId: number): void;
  raptor_clear_networks(): void;
  raptor_run_query(ptr: number, len: number): number;
  raptor_result_ptr(): number;
};

let cachedNative: NativeKilometrRaptorModule | null | undefined;
let cachedWasm: WasmExports | null = null;

const nativeLoadedNetIds = new Set<number>();
const nativeInflightLoads = new Map<number, Promise<boolean>>();
const wasmLoadedNetIds = new Set<number>();

function getNativeModule(): NativeKilometrRaptorModule | null {
  if (cachedNative !== undefined) return cachedNative;
  try {
    const expoGlobal = (
      globalThis as unknown as {
        expo?: { modules?: Record<string, unknown> };
      }
    ).expo;
    const mod = expoGlobal?.modules?.KilometrRaptor as
      | NativeKilometrRaptorModule
      | undefined;
    if (mod && typeof mod.isAvailable === "function" && mod.isAvailable()) {
      cachedNative = mod;
      return mod;
    }
  } catch {
    // Fallback to compiled Rust WASM module.
  }
  cachedNative = null;
  return null;
}

function decodeBase64(b64: string): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet.charCodeAt(i)] = i;
  }
  const cleanLen = b64.length;
  let pad = 0;
  if (cleanLen > 0 && b64[cleanLen - 1] === "=") pad++;
  if (cleanLen > 1 && b64[cleanLen - 2] === "=") pad++;
  const outLen = ((cleanLen * 3) >> 2) - pad;
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  for (let i = 0; i < cleanLen; i += 4) {
    const c0 = lookup[b64.charCodeAt(i)];
    const c1 = lookup[b64.charCodeAt(i + 1)];
    const c2 = lookup[b64.charCodeAt(i + 2)];
    const c3 = lookup[b64.charCodeAt(i + 3)];
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outIdx < outLen) out[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < outLen) out[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < outLen) out[outIdx++] = triple & 0xff;
  }
  return out;
}

function getWasmExports(): WasmExports {
  if (cachedWasm) return cachedWasm;
  const wasmBytes = decodeBase64(RAPTOR_WASM_BASE64);
  const module = new WebAssembly.Module(wasmBytes as BufferSource);
  const instance = new WebAssembly.Instance(module, {});
  cachedWasm = instance.exports as unknown as WasmExports;
  return cachedWasm;
}

function readStatus(bytes: Uint8Array | null): number {
  if (!bytes || bytes.byteLength < 4) return -2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(0, true);
}

async function ensureNativeNetworkAsync(
  nativeMod: NativeKilometrRaptorModule,
  netId: number,
  getPackedNet: () => Uint8Array,
  forceReload = false
): Promise<boolean> {
  if (!forceReload && nativeLoadedNetIds.has(netId)) {
    return true;
  }
  const inflight = nativeInflightLoads.get(netId);
  if (inflight) return inflight;

  const task = (async () => {
    try {
      if (!forceReload && (await nativeMod.hasNetwork(netId))) {
        nativeLoadedNetIds.add(netId);
        return true;
      }
      const packed = getPackedNet();
      const ok = await nativeMod.loadNetwork(netId, packed);
      if (ok) {
        nativeLoadedNetIds.add(netId);
      }
      return ok;
    } finally {
      nativeInflightLoads.delete(netId);
    }
  })();

  nativeInflightLoads.set(netId, task);
  return task;
}

function ensureNativeNetworkSync(
  nativeMod: NativeKilometrRaptorModule,
  netId: number,
  getPackedNet: () => Uint8Array,
  forceReload = false
): boolean {
  if (!forceReload && nativeLoadedNetIds.has(netId)) {
    return true;
  }
  if (!forceReload && nativeMod.hasNetworkSync(netId)) {
    nativeLoadedNetIds.add(netId);
    return true;
  }
  const ok = nativeMod.loadNetworkSync(netId, getPackedNet());
  if (ok) {
    nativeLoadedNetIds.add(netId);
  }
  return ok;
}

function ensureWasmNetworkSync(
  wasm: WasmExports,
  netId: number,
  getPackedNet: () => Uint8Array,
  forceReload = false
): boolean {
  if (!forceReload && wasmLoadedNetIds.has(netId)) {
    return true;
  }
  if (!forceReload && wasm.raptor_has_network(netId) === 1) {
    wasmLoadedNetIds.add(netId);
    return true;
  }
  const packed = getPackedNet();
  const ptr = wasm.raptor_alloc(packed.byteLength);
  try {
    new Uint8Array(wasm.memory.buffer, ptr, packed.byteLength).set(packed);
    const ok = wasm.raptor_load_network(netId, ptr, packed.byteLength) === 1;
    if (ok) {
      wasmLoadedNetIds.add(netId);
    }
    return ok;
  } finally {
    wasm.raptor_dealloc(ptr, packed.byteLength);
  }
}

function runWasmQuerySync(
  netId: number,
  getPackedNet: () => Uint8Array,
  packedQuery: Uint8Array
): Uint8Array | null {
  const wasm = getWasmExports();
  if (!ensureWasmNetworkSync(wasm, netId, getPackedNet, false)) {
    return null;
  }

  const execOnce = (): Uint8Array | null => {
    const qPtr = wasm.raptor_alloc(packedQuery.byteLength);
    try {
      new Uint8Array(wasm.memory.buffer, qPtr, packedQuery.byteLength).set(
        packedQuery
      );
      const outLen = wasm.raptor_run_query(qPtr, packedQuery.byteLength);
      if (outLen === 0) return null;
      const outPtr = wasm.raptor_result_ptr();
      return new Uint8Array(wasm.memory.buffer, outPtr, outLen).slice();
    } finally {
      wasm.raptor_dealloc(qPtr, packedQuery.byteLength);
    }
  };

  let res = execOnce();
  if (readStatus(res) === STATUS_NET_MISSING) {
    wasmLoadedNetIds.delete(netId);
    if (!ensureWasmNetworkSync(wasm, netId, getPackedNet, true)) {
      return null;
    }
    res = execOnce();
  }
  return res;
}

export async function warmupRaptorNetworkAsync(
  netId: number,
  getPackedNet: () => Uint8Array
): Promise<boolean> {
  const nativeMod = getNativeModule();
  if (nativeMod) {
    return ensureNativeNetworkAsync(nativeMod, netId, getPackedNet, false);
  }
  const wasm = getWasmExports();
  return ensureWasmNetworkSync(wasm, netId, getPackedNet, false);
}

export async function runRaptorQueryAsync(
  netId: number,
  getPackedNet: () => Uint8Array,
  packedQuery: Uint8Array
): Promise<Uint8Array | null> {
  const nativeMod = getNativeModule();
  if (nativeMod) {
    const loaded = await ensureNativeNetworkAsync(
      nativeMod,
      netId,
      getPackedNet,
      false
    );
    if (!loaded) return null;
    let res = await nativeMod.runQuery(packedQuery);
    if (readStatus(res) === STATUS_NET_MISSING) {
      nativeLoadedNetIds.delete(netId);
      const reloaded = await ensureNativeNetworkAsync(
        nativeMod,
        netId,
        getPackedNet,
        true
      );
      if (!reloaded) return null;
      res = await nativeMod.runQuery(packedQuery);
    }
    return res;
  }
  return runWasmQuerySync(netId, getPackedNet, packedQuery);
}

export function runRaptorQuerySync(
  netId: number,
  getPackedNet: () => Uint8Array,
  packedQuery: Uint8Array
): Uint8Array | null {
  const nativeMod = getNativeModule();
  if (nativeMod) {
    if (!ensureNativeNetworkSync(nativeMod, netId, getPackedNet, false)) {
      return null;
    }
    let res = nativeMod.runQuerySync(packedQuery);
    if (readStatus(res) === STATUS_NET_MISSING) {
      nativeLoadedNetIds.delete(netId);
      if (!ensureNativeNetworkSync(nativeMod, netId, getPackedNet, true)) {
        return null;
      }
      res = nativeMod.runQuerySync(packedQuery);
    }
    return res;
  }
  return runWasmQuerySync(netId, getPackedNet, packedQuery);
}

export function clearRaptorNetworks(): void {
  nativeLoadedNetIds.clear();
  nativeInflightLoads.clear();
  wasmLoadedNetIds.clear();
  const nativeMod = getNativeModule();
  if (nativeMod) {
    try {
      nativeMod.clearNetworksSync();
    } catch {
      // Ignore native teardown errors.
    }
  }
  if (cachedWasm) {
    try {
      cachedWasm.raptor_clear_networks();
    } catch {
      // Ignore WASM teardown errors.
    }
  }
}
