/**
 * Renderuje launch video do MP4: klatka po klatce w headless Chromium
 * (window.seek + zrzut ekranu), kodowanie w ffmpeg. Bez zależności npm
 * poza esbuild; Chromium i ffmpeg pochodzą z nixpkgs.
 *
 * Użycie (po npm run video:prepare):
 *   nix shell nixpkgs#chromium nixpkgs#ffmpeg-full -c nix develop .#ci -c 'npm run video:render -- --format h'
 * Opcje: --format h|v, --from S, --to S, --fps N, --still 3,12.5 (klatki PNG),
 * --ui 1 (tylko ekrany aplikacji do video/.cache/ui-*.png).
 * Bez GPU: VIDEO_ANGLE=swiftshader (kilka sekund na klatkę zamiast ułamka).
 * Wynik: video/out/kilometr-launch-16x9.mp4 albo kilometr-launch-9x16.mp4.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { build } from 'esbuild';

const ROOT = normalize(join(__dirname, '../..'));
const CACHE = join(ROOT, 'video/.cache');
const OUT = join(ROOT, 'video/out');

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? '');
const format = args.get('format') === 'v' ? 'v' : 'h';
const stills = (args.get('still') ?? '').split(',').filter(Boolean).map(Number);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function serve(): Promise<number> {
  const server = createServer((req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent((req.url ?? '/').split('?')[0])));
    if (!path.startsWith(ROOT + sep) || !existsSync(path) || !statSync(path).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' });
    createReadStream(path).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Serwer bez portu'));
    });
    server.unref();
  });
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

function isMessage(x: unknown): x is CdpMessage {
  return typeof x === 'object' && x !== null;
}

/** Minimalny klient Chrome DevTools Protocol na wbudowanym WebSocket z Node 22. */
async function connect(url: string) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let seq = 0;
  const pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  ws.onmessage = (event) => {
    const msg: unknown = JSON.parse(String(event.data));
    if (!isMessage(msg)) return;
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error.message));
      else p?.resolve(msg.result ?? {});
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown' || (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error')) {
      const text = JSON.stringify(msg.params);
      const description = /"description":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? /"value":"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
      console.error('[strona]', (description ?? text).replace(/\\n/g, '\n').slice(0, 900));
    }
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression: string) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expression}: ${JSON.stringify(r.exceptionDetails).slice(0, 600)}`);
    const result = r.result;
    return typeof result === 'object' && result !== null && 'value' in result ? result.value : undefined;
  };
  return { send, evaluate, close: () => ws.close() };
}

const UI = join(ROOT, 'video/ui');
const STUB = join(UI, 'stub.cjs');
/** Moduły natywne w ekranach aplikacji: własne zamienniki albo uniwersalna zaślepka. */
const UI_MODULES: [RegExp, string][] = [
  [/^react-native$/, join(UI, 'react-native.ts')],
  [/^react-native-web$/, join(ROOT, 'node_modules/react-native-web/dist/index.js')],
  [/^react-native-reanimated$/, join(UI, 'reanimated.tsx')],
  [/^react-native-safe-area-context$/, join(UI, 'safe-area.tsx')],
  [/^react-native-gesture-handler$/, join(UI, 'gesture-handler.tsx')],
  [/^expo-router$/, join(UI, 'router.tsx')],
  [/^@expo\/vector-icons\/MaterialIcons$/, join(UI, 'icons.tsx')],
  [/^(expo($|-)|@expo\/(?!vector-icons\/build)|@react-native-|@react-native\/(?!normalize-colors)|@maplibre\/|@gorhom\/|react-native-(?!web|svg)|react-native\/)/, STUB],
];

/**
 * Zaślepka jako moduł ESM z dokładnie tymi nazwami, które importuje dany plik.
 * Import nazwany z CJS esbuild kopiuje do nowego obiektu, więc Proxy samo nie wystarcza.
 */
function stubModule(importer: string, module: string): string {
  const src = readFileSync(importer, 'utf8');
  const from = `\\s*from\\s*['"]${module.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]`;
  const names = new Set<string>();
  for (const m of src.matchAll(new RegExp(`import\\s+(?:type\\s+)?(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}${from}`, 'g'))) {
    for (const part of m[1].split(',')) names.add(part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]);
  }
  for (const m of src.matchAll(new RegExp(`import\\s+\\*\\s+as\\s+([\\w$]+)${from}`, 'g'))) {
    for (const use of src.matchAll(new RegExp(`\\b${m[1]}\\.([\\w$]+)`, 'g'))) names.add(use[1]);
  }
  names.delete('');
  names.delete('default');
  return [`import stub from ${JSON.stringify(STUB)};`, 'export default stub;', ...[...names].map((n) => `export const ${n} = stub;`)].join('\n');
}

/** Bundle ekranów aplikacji (app/routes) dla react-native-web. */
function buildUi() {
  return build({
    entryPoints: [join(UI, 'main.tsx')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: join(CACHE, 'ui.js'),
    jsx: 'automatic',
    resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.jsx', '.json'],
    mainFields: ['browser', 'module', 'main'],
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
    banner: { js: 'globalThis.process ??= { env: { NODE_ENV: "production" } };' },
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.ttf': 'empty', '.otf': 'empty' },
    logLevel: 'error',
    plugins: [
      {
        name: 'moduly-natywne',
        setup(b) {
          b.onResolve({ filter: /^[@a-z]/ }, (args) => {
            const hit = UI_MODULES.find(([re]) => re.test(args.path));
            if (!hit || args.importer === hit[1]) return undefined;
            if (hit[1] !== STUB || args.kind !== 'import-statement') return { path: hit[1] };
            return { path: `${args.path} @ ${args.importer}`, namespace: 'zaslepka', pluginData: { importer: args.importer, module: args.path } };
          });
          // Status rozkładu liczy się z SQLite, której w przeglądarce nie ma: wideo ustawia go samo.
          b.onLoad({ filter: /src\/services\/dataManager\.ts$/ }, (args) => ({
            contents: `${readFileSync(args.path, 'utf8')}\nexport const setDataStatusForVideo = emit;\n`,
            loader: 'ts',
          }));
          // Udogodnienia i alerty PKP bez bazy / sieci: stały mock na zrzut ekranu.
          b.onLoad({ filter: /src\/services\/railAmenities\.ts$/ }, () => ({
            contents: readFileSync(join(UI, 'rail-amenities.ts'), 'utf8'),
            loader: 'ts',
            resolveDir: UI,
          }));
          b.onLoad({ filter: /src\/services\/railTripAlerts\.ts$/ }, () => ({
            contents: readFileSync(join(UI, 'rail-alerts.ts'), 'utf8'),
            loader: 'ts',
            resolveDir: UI,
          }));
          b.onLoad({ filter: /src\/components\/RouteMapCard\.tsx$/ }, () => ({
            contents: readFileSync(join(UI, 'route-map-card.tsx'), 'utf8'),
            loader: 'tsx',
            resolveDir: UI,
          }));
          b.onLoad({ filter: /src\/services\/useRailLiveConnections\.ts$/ }, () => ({
            contents: readFileSync(join(UI, 'use-rail-live.ts'), 'utf8'),
            loader: 'ts',
            resolveDir: UI,
          }));
          b.onLoad({ filter: /src\/services\/mpkNews\.ts$/ }, () => ({
            contents: readFileSync(join(UI, 'mpk-news.ts'), 'utf8'),
            loader: 'ts',
            resolveDir: UI,
          }));
          b.onLoad({ filter: /src\/services\/ticketStorage\.ts$/ }, () => ({
            contents: readFileSync(join(UI, 'ticket-storage.ts'), 'utf8'),
            loader: 'ts',
            resolveDir: UI,
          }));
          b.onLoad({ filter: /.*/, namespace: 'zaslepka' }, (args) => {
            const data: unknown = args.pluginData;
            if (typeof data !== 'object' || data === null || !('importer' in data) || !('module' in data)) return undefined;
            return { contents: stubModule(String(data.importer), String(data.module)), loader: 'js', resolveDir: UI };
          });
        },
      },
    ],
  });
}

async function main() {
  await build({
    entryPoints: [join(ROOT, 'video/src/main.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: join(CACHE, 'main.js'),
    logLevel: 'warning',
    plugins: [
      {
        name: 'maplibre-z-node-modules',
        setup(b) {
          b.onResolve({ filter: /^maplibre-gl$/ }, () => ({ path: '/node_modules/maplibre-gl/dist/maplibre-gl.mjs', external: true }));
        },
      },
    ],
  });
  await buildUi();
  if (!existsSync(join(CACHE, 'data.json'))) throw new Error('Brak video/.cache/data.json: najpierw npm run video:prepare');
  mkdirSync(OUT, { recursive: true });

  const port = await serve();
  const size = format === 'h' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
  const chrome = spawn(
    process.env.CHROMIUM ?? 'chromium',
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${join(CACHE, 'chrome')}`,
      `--window-size=${size.w},${size.h}`,
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      `--use-angle=${process.env.VIDEO_ANGLE ?? 'gl'}`,
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TZ: 'Europe/Warsaw' } },
  );
  const browserUrl = await new Promise<string>((resolve, reject) => {
    let log = '';
    chrome.stderr.on('data', (chunk: Buffer) => {
      log += chunk.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (m) resolve(m[1]);
    });
    chrome.on('exit', () => reject(new Error(`Chromium zakończył się:\n${log.slice(-2000)}`)));
  });
  const devtools = new URL(browserUrl);
  const targets: unknown = await (await fetch(`http://${devtools.host}/json/list`)).json();
  const list: unknown[] = Array.isArray(targets) ? targets : [];
  const page = list.find(
    (x): x is { webSocketDebuggerUrl: string } =>
      typeof x === 'object' &&
      x !== null &&
      'type' in x &&
      x.type === 'page' &&
      'webSocketDebuggerUrl' in x &&
      typeof x.webSocketDebuggerUrl === 'string',
  );
  if (!page) throw new Error('Brak karty Chromium');
  const cdp = await connect(page.webSocketDebuggerUrl);

  const until = async (expression: string) => {
    for (let i = 0; !(await cdp.evaluate(expression)); i++) {
      if (i > 300) throw new Error(`Strona nie wystartowała: ${expression}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  try {
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    // Ekrany aplikacji w rozmiarze telefonu (393 dp, gęstość 3), potem trafiają do wideo jako PNG.
    for (const screen of ['trip', 'routes', 'train']) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 393, height: 826, deviceScaleFactor: 3, mobile: true });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/video/ui.html?screen=${screen}` });
      await until('window.uiReady === true');
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      if (typeof r.data !== 'string') throw new Error('Pusty zrzut ekranu aplikacji');
      writeFileSync(join(CACHE, `ui-${screen}.png`), Buffer.from(r.data, 'base64'));
    }
    if (args.has('ui')) {
      console.log(join(CACHE, 'ui-trip.png'), join(CACHE, 'ui-routes.png'), join(CACHE, 'ui-train.png'));
      return;
    }

    await cdp.send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/video/index.html?format=${format}` });
    await until('Boolean(window.ready)');
    await cdp.evaluate('window.ready');
    const duration = Number(await cdp.evaluate('window.video.duration'));
    const fps = Number(args.get('fps') ?? (await cdp.evaluate('window.video.fps')));

    let captureMs = 0;
    const shot = async (t: number) => {
      await cdp.evaluate(`window.seek(${t})`);
      const started = Date.now();
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      captureMs = Date.now() - started;
      if (typeof r.data !== 'string') throw new Error('Pusty zrzut');
      return Buffer.from(r.data, 'base64');
    };

    if (stills.length) {
      for (const t of stills) {
        const started = Date.now();
        const file = join(OUT, `still-${format}-${t.toFixed(1).padStart(4, '0')}.png`);
        writeFileSync(file, await shot(t));
        const ms = await cdp.evaluate('window.video.ms.map(Math.round).join("/")');
        console.log(`${file} (${Date.now() - started} ms; mapa/rysowanie/klatka ${String(ms)}, zrzut ${captureMs})`);
      }
      return;
    }

    const from = Number(args.get('from') ?? 0);
    const to = Math.min(duration, Number(args.get('to') ?? duration));
    const partial = from > 0 || to < duration;
    const name = `kilometr-launch-${format === 'h' ? '16x9' : '9x16'}${partial ? `-${from}-${to}` : ''}.mp4`;
    const file = join(OUT, name);
    const ffmpeg = spawn(
      process.env.FFMPEG ?? 'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-c:v',
        'png',
        '-framerate',
        String(fps),
        '-i',
        '-',
        '-vf',
        'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'slow',
        '-crf',
        '16',
        '-colorspace',
        'bt709',
        '-color_primaries',
        'bt709',
        '-color_trc',
        'bt709',
        '-movflags',
        '+faststart',
        file,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const done = new Promise<void>((resolve, reject) =>
      ffmpeg.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: kod ${code}`)))),
    );
    const frames = Math.round((to - from) * fps);
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const png = await shot(from + i / fps);
      if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
      if (i % 30 === 29 || i === frames - 1) {
        const per = (Date.now() - started) / (i + 1) / 1000;
        console.log(`${format} klatka ${i + 1}/${frames}, ${per.toFixed(2)} s/klatkę, zostało ~${Math.round((frames - i - 1) * per)} s`);
      }
    }
    ffmpeg.stdin.end();
    await done;
    const stalls = Number(await cdp.evaluate('window.video.stalls'));
    console.log(`${file}${stalls ? ` (klatek bez pełnej mapy: ${stalls})` : ''}`);
  } finally {
    cdp.close();
    chrome.kill();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
