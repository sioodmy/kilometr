// Warstwy HTML nad mapą: napisy, telefon z ekranami aplikacji, powiadomienie,
// obietnica i plansza końcowa.

import type { VideoData } from './data';
import {
  ATTRIBUTION,
  CLOSING,
  FOLLOW_END,
  FOLLOW_START,
  LIVE_NOTE,
  NOTIFY,
  PLATFORMS,
  PROMISE,
  S,
  SITE,
  clamp01,
  copyFor,
  easeInOut,
  easeOut,
  ramp,
  smooth,
  visible,
  type Format,
} from './timeline';

type XY = [number, number];

export interface Marks {
  focus: XY | null;
  origin: XY | null;
  /** Skala pinu Sky Tower (maleje przy oddaleniu kamery). */
  originScale: number;
  destination: XY | null;
  cities: XY[];
  warsaw: XY | null;
  /** Gdy true, plakietka pokazuje numer pociągu IC zamiast linii tramwaju. */
  railLabel?: boolean;
}

const LABELLED = new Set(['wroclaw', 'warszawa', 'krakow', 'poznan', 'trojmiasto', 'lodz', 'gzm', 'szczecin', 'lublin', 'bialystok', 'rzeszow']);

const LOGO = `
<svg viewBox="0 0 1024 1024" aria-hidden="true">
  <rect class="logo-bg" width="1024" height="1024" rx="232" fill="#00a884"/>
  <g transform="translate(512 512) scale(0.82) translate(-512 -512)">
    <g fill="none" stroke="#04362c" stroke-width="80" stroke-linecap="round" stroke-linejoin="round">
      <path class="logo-track" pathLength="1" d="M352 180 L352 794"/>
      <path class="logo-up" pathLength="1" d="M352 512 C390 380 480 300 600 220"/>
      <path class="logo-down" pathLength="1" d="M352 512 C400 664 510 754 672 754"/>
    </g>
    <g transform="translate(605 215) rotate(-35)">
      <path class="logo-arrow" d="M-18 -68 L96 0 L-18 68 L8 0 Z" fill="#04362c" stroke="#04362c" stroke-width="40" stroke-linejoin="round"/>
    </g>
    <g class="logo-node"><circle cx="352" cy="512" r="102" fill="#04362c"/><circle cx="352" cy="512" r="50" fill="#00a884"/></g>
    <circle class="logo-stop" cx="672" cy="754" r="32" fill="#04362c"/>
  </g>
</svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text = '') {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text;
  parent.append(node);
  return node;
}

function q<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Brak elementu ${selector}`);
  return node;
}

/** Linie wjeżdżające spod maski, jedna po drugiej. */
function lines(parent: HTMLElement, texts: string[]) {
  parent.textContent = '';
  return texts.map((text) => {
    const line = el('span', 'line', parent);
    return el('span', '', line, text);
  });
}

function reveal(spans: HTMLElement[], t: number, at: number, step = 0.12, dur = 0.6) {
  spans.forEach((span, i) => {
    const k = easeOut(ramp(t, at + i * step, at + i * step + dur));
    span.style.transform = `translateY(${(1 - k) * 112}%)`;
  });
}

function show(node: HTMLElement, opacity: number) {
  node.style.opacity = String(opacity);
  node.style.visibility = opacity > 0.001 ? 'visible' : 'hidden';
}

function place(node: HTMLElement, p: XY | null, opacity: number, scale = 1) {
  if (!p) return show(node, 0);
  const s = Math.max(0.01, scale);
  node.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) scale(${s.toFixed(3)})`;
  node.style.transformOrigin = 'left center';
  show(node, opacity * (scale < 0.08 ? 0 : 1));
}

export function createScenes(stage: HTMLElement, data: VideoData, format: Format) {
  const copies = copyFor(data.cities.length);
  const labels = q<HTMLElement>(stage, '#labels');
  const pinOrigin = el('div', 'pin', labels, data.origin.name);
  const dest = data.journey.stops[data.journey.stops.length - 1];
  const pinDest = el('div', 'pin', labels, dest.name);
  const pinWarsaw = el('div', 'city', labels, data.rail.warsaw.name);
  const badge = el('div', 'badge', labels, data.journey.line);
  const cityLabels = data.cities.map((c) => (LABELLED.has(c.id) ? el('div', 'city', labels, c.name) : null));

  const copy = q<HTMLElement>(stage, '#copy');
  const title = q<HTMLElement>(copy, '#title');
  const sub = q<HTMLElement>(copy, '#sub');
  let active = -1;
  let spans: HTMLElement[] = [];

  // Obudowa Pixel 9 Pro: shell + boczne przyciski + bezel + ekran.
  const phone = q<HTMLElement>(stage, '#phone');
  const shell = el('div', 'shell', phone);
  el('i', 'btn btn-vol-up', shell);
  el('i', 'btn btn-vol-down', shell);
  el('i', 'btn btn-power', shell);
  const bezel = el('div', 'bezel', shell);
  const screen = el('div', 'screen', bezel);
  const status = el('div', 'status', screen);
  el('span', 'clock', status, '20:25');
  el('i', 'punch', screen);
  const icons = el('span', 'icons', status);
  icons.innerHTML =
    `<svg class="net" viewBox="0 0 24 24"><path d="M2 22h20V2z"/></svg>` +
    `<svg class="net" viewBox="0 0 24 24"><path d="M12 21 1 9.5a15.5 15.5 0 0 1 22 0z"/></svg>` +
    `<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/></svg>`;
  const trip = el('img', 'shot', screen);
  // Zrzuty prawdziwych ekranów aplikacji, robi je render.ts przed wideo (video/ui).
  trip.src = '/video/.cache/ui-trip.png';
  const train = el('img', 'shot', screen);
  train.src = '/video/.cache/ui-train.png';

  // Live Update jak Android 16 ProgressStyle (LiveUpdateFactory).
  const notif = q<HTMLElement>(stage, '#notif');
  notif.className = 'live-update';
  const luTop = el('div', 'lu-top', notif);
  const luIcon = el('img', 'lu-app-icon', luTop);
  luIcon.src = '/assets/icon.png';
  el('span', 'lu-app', luTop, 'kilometr');
  const luChrono = el('span', 'lu-chrono', luTop, '4:12');
  const lineName = data.journey.line.startsWith('Tramwaj')
    ? data.journey.line
    : `Tramwaj ${data.journey.line}`;
  const arriveClock = (() => {
    const s = dest.time;
    return `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
  })();
  el('div', 'lu-title', notif, NOTIFY.rideTitle(lineName, arriveClock));
  el('div', 'lu-text', notif, NOTIFY.alightAt(dest.name));
  const nSub = el('div', 'lu-sub', notif, '');
  const progress = el('div', 'lu-progress', notif);
  const track = el('div', 'lu-track', progress);
  el('i', 'lu-seg lu-walk', track);
  const rideSeg = el('i', 'lu-seg lu-ride', track);
  rideSeg.style.background = data.journey.color;
  const tracker = el('div', 'lu-tracker', progress);
  tracker.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M4 17.5v-9.5q0-2.425 2.125-3.175T11 4l.75-1.5H7.75q-.325 0-.537-.213T7 1.75q0-.325.213-.537T7.75 1h8.5q.325 0 .537.213T17 1.75q0 .325-.213.537T16.25 2.5H13.75l-.75 1.5q2.975.075 4.988.812T20 8v9.5q0 1.475-1.012 2.488T16.5 21l.5.5q.425.425.2.963T16.375 23q-.175 0-.338-.062T15.75 22.75L14 21H10l-1.75 1.75q-.125.125-.288.188T7.625 23q-.575 0-.812-.537T7 21.5l.5-.5q-1.475 0-2.488-1.012T4 17.5Zm9.062.062Q13.5 17.125 13.5 16.5t-.438-1.062Q12.625 15 12 15t-1.062.438Q10.5 15.875 10.5 16.5t.438 1.062Q11.375 18 12 18t1.062-.438ZM6 12h12v-3H6v3Z"/></svg>`;
  const flag = el('div', 'lu-flag', progress);
  flag.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 21V3h2v2h12l-2.5 4L19 13H7v8H5Z"/></svg>`;
  const actions = el('div', 'lu-actions', notif);
  el('button', 'lu-action', actions, NOTIFY.actionStop);
  el('button', 'lu-action', actions, NOTIFY.actionRoute);

  // Alert opóźnienia NA ekranie telefonu (shade Androida), nie poza mockiem.
  const delay = el('div', '', screen);
  delay.id = 'delay';
  delay.className = 'android-alert';
  const dTop = el('div', 'lu-top', delay);
  const dIcon = el('img', 'lu-app-icon', dTop);
  dIcon.src = '/assets/icon.png';
  el('span', 'lu-app', dTop, 'kilometr');
  el('span', 'lu-chrono', dTop, 'teraz');
  el('div', 'lu-title delay-title', delay, 'Opóźnienie +10 minut');
  el('div', 'lu-text', delay, 'Ograniczenie prędkości pociągu');

  const promise = q<HTMLElement>(stage, '#promise');
  const promiseSpans = lines(promise, PROMISE);

  const end = q<HTMLElement>(stage, '#end');
  const logo = el('div', 'logo', end);
  logo.innerHTML = LOGO;
  const name = el('div', 'end-name', end, 'Kilometr');
  const words = CLOSING.split(' ');
  const cut = Math.ceil(words.length / 2);
  const endTitle = el('div', 'end-title', end);
  const endSpans = lines(endTitle, [words.slice(0, cut).join(' '), words.slice(cut).join(' ')].filter(Boolean));
  const meta = el('div', 'end-meta', end);
  el('span', 'end-site', meta, SITE);
  el('span', '', meta, PLATFORMS);
  const logoBg = q<SVGElement>(logo, '.logo-bg');
  const strokes = (['.logo-track', '.logo-up', '.logo-down'] as const).map((s) => q<SVGElement>(logo, s));
  const node = q<SVGElement>(logo, '.logo-node');
  const stop = q<SVGElement>(logo, '.logo-stop');
  const arrow = q<SVGElement>(logo, '.logo-arrow');

  const attrib = q<HTMLElement>(stage, '#attrib');
  el('span', '', attrib, ATTRIBUTION);
  const liveNote = el('span', 'live-note', attrib, ` · ${LIVE_NOTE}`);

  const scrim = q<HTMLElement>(stage, '#scrim');
  const dim = q<HTMLElement>(stage, '#dim');

  return {
    update(t: number, marks: Marks, journeyStop: number, journeyProgress: number) {
      // Napisy scen 1-6.
      const idx = copies.findIndex((c) => t >= c.at && t < c.to);
      if (idx !== active) {
        active = idx;
        if (idx >= 0) {
          spans = lines(title, copies[idx].title);
          sub.textContent = copies[idx].sub;
        }
      }
      if (idx >= 0) {
        const c = copies[idx];
        reveal(spans, t, c.at);
        const subK = easeOut(ramp(t, c.at + (idx === 0 ? 1.2 : 0.35), c.at + (idx === 0 ? 1.8 : 0.95)));
        sub.style.opacity = String(subK);
        sub.style.transform = `translateY(${(1 - subK) * 18}px)`;
        const out = ramp(t, c.to - 0.35, c.to);
        copy.style.opacity = String(1 - out);
        copy.style.transform = `translateY(${-out * 24}px)`;
        show(copy, 1 - out);
      } else show(copy, 0);

      show(scrim, visible(t, 0, S.promise + 0.2, 0.5));
      const dimK = Math.max(
        0.18 * visible(t, S.poland + 1.2, S.promise + 0.4, 0.8),
        0.9 * ramp(t, S.promise - 0.2, S.promise + 0.6),
      );
      dim.style.opacity = String(dimK);

      // Etykiety na mapie.
      place(
        pinOrigin,
        marks.origin,
        visible(t, 0.35, S.live + 0.2, 0.35) * clamp01(marks.originScale * 1.2),
        marks.originScale,
      );
      place(pinDest, marks.destination, visible(t, S.route + 1.0, S.live + 0.2, 0.35));
      place(pinWarsaw, marks.warsaw, visible(t, S.train + 0.6, S.poland + 0.3, 0.35));
      badge.textContent = marks.railLabel ? data.rail.line : data.journey.line;
      place(badge, marks.focus, visible(t, S.live + 0.4, S.poland + 0.4, 0.4));
      cityLabels.forEach((label, i) => {
        if (!label) return;
        place(
          label,
          marks.cities[i] ?? null,
          smooth(ramp(t, S.poland + 1.4 + i * 0.025, S.poland + 1.8 + i * 0.025)) *
            visible(t, S.poland, S.promise + 0.15, 0.35),
        );
      });

      // Telefon 1: szczegóły tramwaju (hint + live). Telefon 2: IC do Warszawy.
      const phone1In = easeInOut(ramp(t, S.route + 0.35, S.route + 0.95));
      const phone1Out = easeInOut(ramp(t, S.live - 0.55, S.live - 0.05));
      const phone2In = easeInOut(ramp(t, S.train + 0.45, S.train + 1.0));
      const phone2Out = easeInOut(ramp(t, S.poland - 0.7, S.poland - 0.15));
      const off1 = 1 - phone1In + phone1Out;
      const off2 = 1 - phone2In + phone2Out;
      const off = Math.min(off1, off2);
      phone.style.transform = format === 'h' ? `translateX(${off * 125}%)` : `translateY(${off * 105}%)`;
      show(phone, off >= 1 ? 0 : 1);
      train.style.opacity = String(smooth(ramp(t, S.train + 0.5, S.train + 0.85)));

      // Live Update podczas śledzenia: znika przy przyjeździe na Katedrę.
      const nIn = easeOut(ramp(t, FOLLOW_START + 0.35, FOLLOW_START + 0.75));
      const nOut = ramp(t, FOLLOW_END - 0.15, FOLLOW_END + 0.05);
      notif.style.transform = `translateY(${(1 - nIn) * -36}px)`;
      show(notif, nIn * (1 - nOut));
      const next = data.journey.stops[Math.min(journeyStop, data.journey.stops.length - 1)];
      nSub.textContent = [NOTIFY.nextStop(next.name), NOTIFY.stops(Math.max(1, data.journey.stops.length - journeyStop))].join(' · ');
      tracker.style.left = `${(8 + journeyProgress * 78).toFixed(1)}%`;
      const chronoSec = Math.max(0, Math.round((1 - journeyProgress) * (dest.time - data.journey.stops[0].time)));
      luChrono.textContent = `${Math.floor(chronoSec / 60)}:${String(chronoSec % 60).padStart(2, '0')}`;

      // Alert opóźnienia na ekranie telefonu (wjeżdża z góry, bez wychodzenia poza bezel).
      const dIn = easeOut(ramp(t, S.train + 1.4, S.train + 1.9));
      const dOut = ramp(t, S.poland - 1.0, S.poland - 0.45);
      delay.style.transform = `translateY(${(1 - dIn) * -16}px)`;
      show(delay, dIn * (1 - dOut) * phone2In * (1 - phone2Out));

      // Obietnica.
      show(promise, 1 - ramp(t, S.end - 0.25, S.end + 0.05));
      promiseSpans.forEach((span, i) => {
        const k = easeOut(ramp(t, S.promise + 0.25 + i * 0.55, S.promise + 0.7 + i * 0.55));
        span.style.transform = `translateY(${(1 - k) * 112}%)`;
      });

      // Plansza końcowa: znak rysuje się jak linia na mapie.
      const e = S.end;
      show(end, ramp(t, e, e + 0.15));
      const bgK = easeOut(ramp(t, e + 0.08, e + 0.4));
      logoBg.style.transform = `scale(${0.6 + 0.4 * bgK})`;
      logoBg.style.opacity = String(bgK);
      strokes.forEach((s, i) => {
        const k = easeInOut(ramp(t, e + 0.28 + i * 0.18, e + 0.7 + i * 0.18));
        s.style.strokeDashoffset = String(1 - k);
        s.style.opacity = k > 0 ? '1' : '0';
      });
      const nodeK = easeOut(ramp(t, e + 0.4, e + 0.65));
      node.style.transform = `scale(${nodeK})`;
      const stopK = easeOut(ramp(t, e + 0.85, e + 1.05));
      stop.style.transform = `scale(${stopK})`;
      arrow.style.opacity = String(ramp(t, e + 0.75, e + 0.95));
      const nameK = easeOut(ramp(t, e + 0.9, e + 1.3));
      name.style.opacity = String(nameK);
      name.style.transform = `translateY(${(1 - nameK) * 20}px)`;
      reveal(endSpans, t, e + 1.15, 0.12, 0.55);
      const metaK = easeOut(ramp(t, e + 1.6, e + 2.1));
      meta.style.opacity = String(metaK);

      show(attrib, visible(t, 0, S.promise + 0.15, 0.35));
      show(liveNote, visible(t, S.live + 0.3, S.train, 0.35));
    },
  };
}
