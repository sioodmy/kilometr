import { RAPTOR_WASM_BASE64 } from "./wasmBase64";

const STATUS_NET_MISSING = -1;
const FOOT_QUERY_MAGIC = 0x464f4f54; // "FOOT"

type NativeKilometrRaptorModule = {
  isAvailable(): boolean;
  hasNetworkSync(netId: number): boolean;
  loadNetworkSync(netId: number, packedNet: Uint8Array): boolean;
  dropNetworkSync(netId: number): void;
  clearNetworksSync(): void;
  runQuerySync(packedQuery: Uint8Array): Uint8Array | null;
  hasFootTileSync(tx: number, ty: number): boolean;
  loadFootTileSync(tx: number, ty: number, mvtBytes: Uint8Array): boolean;
  loadFootTileFromPackSync(tx: number, ty: number): boolean;
  clearFootTilesSync(): void;
  routeFootSync(packedReq: Uint8Array): Uint8Array | null;
  hasNetwork(netId: number): Promise<boolean>;
  loadNetwork(netId: number, packedNet: Uint8Array): Promise<boolean>;
  dropNetwork(netId: number): Promise<void>;
  clearNetworks(): Promise<void>;
  runQuery(packedQuery: Uint8Array): Promise<Uint8Array | null>;
  hasFootTile(tx: number, ty: number): Promise<boolean>;
  loadFootTile(tx: number, ty: number, mvtBytes: Uint8Array): Promise<boolean>;
  loadFootTileFromPack(tx: number, ty: number): Promise<boolean>;
  clearFootTiles(): Promise<void>;
  routeFoot(packedReq: Uint8Array): Promise<Uint8Array | null>;
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
  raptor_has_foot_tile(tx: number, ty: number): number;
  raptor_load_foot_tile(tx: number, ty: number, ptr: number, len: number): number;
  raptor_clear_foot_tiles(): void;
  raptor_route_foot(ptr: number, len: number): number;
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

export function hasFootTileSync(tx: number, ty: number): boolean {
  const nativeMod = getNativeModule();
  if (nativeMod) {
    return nativeMod.hasFootTileSync(tx, ty);
  }
  const wasm = getWasmExports();
  return wasm.raptor_has_foot_tile(tx, ty) === 1;
}

export async function ensureFootTileFromPackAsync(
  tx: number,
  ty: number
): Promise<boolean> {
  const nativeMod = getNativeModule();
  if (!nativeMod) return false;
  try {
    return await nativeMod.loadFootTileFromPack(tx, ty);
  } catch {
    return false;
  }
}

export async function loadFootTileAsync(
  tx: number,
  ty: number,
  mvtBytes: Uint8Array
): Promise<boolean> {
  if (mvtBytes.byteLength === 0) return false;
  const nativeMod = getNativeModule();
  if (nativeMod) {
    return nativeMod.loadFootTile(tx, ty, mvtBytes);
  }
  return loadFootTileSync(tx, ty, mvtBytes);
}

export function loadFootTileSync(
  tx: number,
  ty: number,
  mvtBytes: Uint8Array
): boolean {
  if (mvtBytes.byteLength === 0) return false;
  const nativeMod = getNativeModule();
  if (nativeMod) {
    return nativeMod.loadFootTileSync(tx, ty, mvtBytes);
  }
  const wasm = getWasmExports();
  const ptr = wasm.raptor_alloc(mvtBytes.byteLength);
  try {
    new Uint8Array(wasm.memory.buffer, ptr, mvtBytes.byteLength).set(mvtBytes);
    return wasm.raptor_load_foot_tile(tx, ty, ptr, mvtBytes.byteLength) === 1;
  } finally {
    wasm.raptor_dealloc(ptr, mvtBytes.byteLength);
  }
}

function packFootWaypoints(waypoints: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const buf = new ArrayBuffer(8 + waypoints.length * 16);
  const view = new DataView(buf);
  view.setUint32(0, FOOT_QUERY_MAGIC, true);
  view.setUint32(4, waypoints.length, true);
  let offset = 8;
  for (let i = 0; i < waypoints.length; i++) {
    view.setFloat64(offset, waypoints[i][0], true);
    view.setFloat64(offset + 8, waypoints[i][1], true);
    offset += 16;
  }
  return new Uint8Array(buf);
}

function unpackFootRoute(bytes: Uint8Array | null): [number, number][] | null {
  if (!bytes || bytes.byteLength < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const status = view.getInt32(0, true);
  if (status !== 0) return null;
  const count = view.getUint32(4, true);
  if (count < 2 || bytes.byteLength < 8 + count * 16) return null;
  const out: [number, number][] = new Array(count);
  let offset = 8;
  for (let i = 0; i < count; i++) {
    const lat = view.getFloat64(offset, true);
    const lon = view.getFloat64(offset + 8, true);
    out[i] = [lat, lon];
    offset += 16;
  }
  return out;
}

export function routeFootWaypointsSync(
  waypoints: ReadonlyArray<readonly [number, number]>
): [number, number][] | null {
  if (waypoints.length < 2) return null;
  const packed = packFootWaypoints(waypoints);
  const nativeMod = getNativeModule();
  if (nativeMod) {
    return unpackFootRoute(nativeMod.routeFootSync(packed));
  }
  const wasm = getWasmExports();
  const ptr = wasm.raptor_alloc(packed.byteLength);
  try {
    new Uint8Array(wasm.memory.buffer, ptr, packed.byteLength).set(packed);
    const outLen = wasm.raptor_route_foot(ptr, packed.byteLength);
    if (outLen === 0) return null;
    const outPtr = wasm.raptor_result_ptr();
    const res = new Uint8Array(wasm.memory.buffer, outPtr, outLen).slice();
    return unpackFootRoute(res);
  } finally {
    wasm.raptor_dealloc(ptr, packed.byteLength);
  }
}

export async function routeFootWaypointsAsync(
  waypoints: ReadonlyArray<readonly [number, number]>
): Promise<[number, number][] | null> {
  if (waypoints.length < 2) return null;
  const packed = packFootWaypoints(waypoints);
  const nativeMod = getNativeModule();
  if (nativeMod) {
    const res = await nativeMod.routeFoot(packed);
    return unpackFootRoute(res);
  }
  return routeFootWaypointsSync(waypoints);
}

export function clearFootTiles(): void {
  const nativeMod = getNativeModule();
  if (nativeMod) {
    try {
      nativeMod.clearFootTilesSync();
    } catch {
      // Ignore native teardown errors.
    }
  }
  if (cachedWasm) {
    try {
      cachedWasm.raptor_clear_foot_tiles();
    } catch {
      // Ignore WASM teardown errors.
    }
  }
}
