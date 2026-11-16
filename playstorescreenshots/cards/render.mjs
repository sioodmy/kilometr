// Renderuje panoramę 5400x1920, 5 kart 1080x1920 oraz feature-graphic 1024x500 do Google Play.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = resolve(import.meta.dirname, 'out');
const CHROMIUM =
  process.env.CHROMIUM ??
  '/nix/store/l5h9bxzx8r488l3kay5wxm0b2bzjjavz-chromium-157.0.8103.50/bin/chromium';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function startServer() {
  return new Promise((resolvePromise) => {
    const server = createServer(async (req, res) => {
      try {
        const cleanPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const rel = cleanPath === '/' ? '/playstorescreenshots/cards/index.html' : cleanPath;
        const filePath = resolve(ROOT, '.' + rel);
        if (!filePath.startsWith(ROOT)) {
          res.writeHead(403).end();
          return;
        }
        const info = await stat(filePath);
        if (!info.isFile()) {
          res.writeHead(404).end();
          return;
        }
        const data = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Bad server address');
      resolvePromise({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

async function launchBrowser() {
  const userDataDir = await mkdtemp('/tmp/chr-playstore-');
  const proc = spawn(
    CHROMIUM,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--hide-scrollbars',
      '--disable-dev-shm-usage',
      '--window-size=5400,1920',
      'about:blank',
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, TMPDIR: '/tmp', XDG_RUNTIME_DIR: '/tmp' },
    },
  );

  const wsUrl = await new Promise((resolvePromise, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Chromium start timeout: ${stderr}`)), 15_000);
    proc.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolvePromise(match[1]);
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chromium exited (${code}): ${stderr}`));
    });
  });

  return { proc, wsUrl, userDataDir };
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id == null) return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message));
      else entry.resolve(msg.result);
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', () => res(), { once: true });
      ws.addEventListener('error', (err) => rej(new Error(`WS error: ${err?.message ?? 'unknown'}`)), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    this.ws.close();
  }
}

async function waitPageReady(cdp, sessionId, expectedImages) {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const check = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const imgs = Array.from(document.images);
          return document.readyState === 'complete' && document.fonts.status === 'loaded' && imgs.length === ${expectedImages} && imgs.every(img => img.complete && img.naturalWidth > 0);
        })()`,
        returnByValue: true,
      },
      sessionId,
    );
    if (check.result.value) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Page did not finish loading fonts and images');
  await cdp.send(
    'Runtime.evaluate',
    { expression: `document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`, awaitPromise: true },
    sessionId,
  );
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const srv = await startServer();
  const { proc, wsUrl, userDataDir } = await launchBrowser();
  const cdp = await CDP.connect(wsUrl);

  try {
    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'about:blank',
    });
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });

    await cdp.send('Page.enable', {}, sessionId);

    // 1. Karty 5400x1920 -> panorama.png + 1..5.png
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 5400, height: 1920, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await cdp.send('Page.navigate', { url: `${srv.url}/playstorescreenshots/cards/index.html` }, sessionId);
    await waitPageReady(cdp, sessionId, 5);

    const audit = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `JSON.stringify((() => {
          const seams = [1080, 2160, 3240, 4320];
          const textCrossings = [];
          const selectors = '.copy, .b12-val, .b12-label, .b23-eta, .b23-live, .b23-sub, .b23-via, .b23-dur, .line-pill, .leg-walk, .lu-main, .lu-sub, .lu-arr, .lu-arr-time, .lu-actions span, .tag-alert, .tag-plan, .line-bus-sm, .b45-rtitle, .w-quick, .w-hint, .w-train, .w-share, .w-detour, .w-skip';
          for (const el of document.querySelectorAll(selectors)) {
            const r = el.getBoundingClientRect();
            for (const s of seams) {
              if (r.left < s && r.right > s) {
                textCrossings.push({ text: el.innerText.trim().slice(0, 40), seam: s, left: r.left, right: r.right });
              }
            }
          }
          const copyFloatCollisions = [];
          const copies = Array.from(document.querySelectorAll('.copy')).map(e => e.getBoundingClientRect());
          for (const fl of document.querySelectorAll('.ui-float, .phone')) {
            const r = fl.getBoundingClientRect();
            for (const c of copies) {
              if (r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top) {
                copyFloatCollisions.push({ cls: fl.className, r, c });
              }
            }
          }
          return { textCrossings, copyFloatCollisions };
        })())`,
        returnByValue: true,
      },
      sessionId,
    );
    console.log('Seam & collision audit:', audit.result.value);

    const shot = async (name, x, width, height) => {
      const { data } = await cdp.send(
        'Page.captureScreenshot',
        { format: 'png', clip: { x, y: 0, width, height, scale: 1 } },
        sessionId,
      );
      await writeFile(join(OUT, name), Buffer.from(data, 'base64'));
      console.log(`Saved ${name} (${width}x${height})`);
    };

    await shot('panorama.png', 0, 5400, 1920);
    for (let i = 0; i < 5; i++) {
      await shot(`${i + 1}.png`, i * 1080, 1080, 1920);
    }

    // 2. Grafika pozioma 1024x500 (Feature Graphic)
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 1024, height: 500, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await cdp.send('Page.navigate', { url: `${srv.url}/playstorescreenshots/cards/feature-graphic.html` }, sessionId);
    await waitPageReady(cdp, sessionId, 5);

    const fgAudit = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `JSON.stringify((() => {
          const leftBoxes = Array.from(document.querySelectorAll('.brand, .hero-copy')).map(e => ({ cls: e.className, r: e.getBoundingClientRect() }));
          const rightBoxes = Array.from(document.querySelectorAll('.hero-city, .phone')).map(e => ({ cls: e.className, r: e.getBoundingClientRect() }));
          const collisions = [];
          for (const l of leftBoxes) {
            for (const o of rightBoxes) {
              if (l.r.left < o.r.right && l.r.right > o.r.left && l.r.top < o.r.bottom && l.r.bottom > o.r.top) {
                collisions.push({ left: l.cls, right: o.cls, l: l.r, o: o.r });
              }
            }
          }
          const badgeOverflows = [];
          for (const mark of document.querySelectorAll('.hero-city-mark')) {
            const mr = mark.getBoundingClientRect();
            const img = mark.querySelector('img');
            const ir = img.getBoundingClientRect();
            if (ir.width > mr.width || ir.height > mr.height || ir.left < mr.left - 0.5 || ir.right > mr.right + 0.5 || ir.top < mr.top - 0.5 || ir.bottom > mr.bottom + 0.5) {
              badgeOverflows.push({ src: img.getAttribute('src'), mark: mr, img: ir });
            }
          }
          return { leftBoxes, collisions, badgeOverflows };
        })())`,
        returnByValue: true,
      },
      sessionId,
    );
    console.log('Feature graphic audit:', fgAudit.result.value);
    await shot('feature-graphic.png', 0, 1024, 500);
  } catch (err) {
    console.error('Render failed:', err);
    process.exitCode = 1;
  } finally {
    cdp.close();
    const exited = new Promise((r) => proc.once('exit', r));
    proc.kill('SIGKILL');
    await exited.catch(() => {});
    srv.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
