// Warstwy HTML nad mapą: napisy, telefon z ekranami aplikacji, powiadomienie,
// obietnica i plansza końcowa.

import type { VideoData } from './data';
import {
  ATTRIBUTION,
  CLOSING,
  LIVE_NOTE,
  NOTIFY,
  PLATFORMS,
  PROMISE,
  S,
  SITE,
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
  destination: XY | null;
  cities: XY[];
}

const LABELLED = new Set(['wroclaw', 'warszawa', 'krakow', 'poznan', 'trojmiasto', 'lodz', 'gzm', 'szczecin', 'lublin', 'bialystok', 'rzeszow']);

const AIRPLANE =
  'M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z';

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

function place(node: HTMLElement, p: XY | null, opacity: number) {
  if (!p) return show(node, 0);
  node.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px)`;
  show(node, opacity);
}

export function createScenes(stage: HTMLElement, data: VideoData, format: Format) {
  const copies = copyFor(data.cities.length);
  const labels = q<HTMLElement>(stage, '#labels');
  const pinOrigin = el('div', 'pin', labels, data.origin.name);
  const dest = data.journey.stops[data.journey.stops.length - 1];
  const pinDest = el('div', 'pin', labels, dest.name);
  const badge = el('div', 'badge', labels, data.journey.line);
  const cityLabels = data.cities.map((c) => (LABELLED.has(c.id) ? el('div', 'city', labels, c.name) : null));

  const copy = q<HTMLElement>(stage, '#copy');
  const title = q<HTMLElement>(copy, '#title');
  const sub = q<HTMLElement>(copy, '#sub');
  let active = -1;
  let spans: HTMLElement[] = [];

  const phone = q<HTMLElement>(stage, '#phone');
  const screen = el('div', 'screen', phone);
  const status = el('div', 'status', screen);
  el('span', 'clock', status, '20:25');
  el('i', 'punch', status);
  const icons = el('span', 'icons', status);
  icons.innerHTML =
    `<svg class="net" viewBox="0 0 24 24"><path d="M2 22h20V2z"/></svg>` +
    `<svg class="net" viewBox="0 0 24 24"><path d="M12 21 1 9.5a15.5 15.5 0 0 1 22 0z"/></svg>` +
    `<svg class="plane" viewBox="0 0 24 24"><path d="${AIRPLANE}"/></svg>` +
    `<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/></svg>`;
  const nets = [...icons.querySelectorAll<SVGElement>('.net')];
  const plane = q<SVGElement>(icons, '.plane');
  const trip = el('img', 'shot', screen);
  trip.src = '/landing/public/screenshots/trip.png';
  const routes = el('img', 'shot', screen);
  routes.src = '/landing/public/screenshots/routes.png';

  const notif = q<HTMLElement>(stage, '#notif');
  const head = el('div', 'notif-head', notif);
  const icon = el('img', '', head);
  icon.src = '/assets/icon.png';
  el('span', '', head, 'Kilometr');
  const nTitle = el('div', 'notif-title', notif, NOTIFY.alightAt(dest.name));
  const nBody = el('div', 'notif-body', notif);
  const nBar = el('i', '', el('div', 'notif-bar', notif));

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
      place(pinOrigin, marks.origin, visible(t, 0.5, S.live + 0.3, 0.4));
      place(pinDest, marks.destination, visible(t, 8.4, S.live + 0.3, 0.4));
      place(badge, marks.focus, visible(t, S.live + 0.6, S.poland + 0.6, 0.5));
      cityLabels.forEach((label, i) => {
        if (!label) return;
        place(label, marks.cities[i] ?? null, smooth(ramp(t, S.poland + 2.2 + i * 0.03, S.poland + 2.7 + i * 0.03)) * visible(t, S.poland, S.promise + 0.2, 0.4));
      });

      // Telefon: trasa, potem tryb samolotowy i lista połączeń.
      const phoneIn = easeInOut(ramp(t, 8.0, 8.9));
      const phoneOut = easeInOut(ramp(t, S.live - 0.6, S.live + 0.2));
      const off = (1 - phoneIn) + phoneOut;
      phone.style.transform = format === 'h' ? `translateX(${off * 125}%)` : `translateY(${off * 105}%)`;
      show(phone, off >= 1 ? 0 : 1);
      const air = smooth(ramp(t, 13.4, 13.8));
      nets.forEach((n) => (n.style.opacity = String(1 - air)));
      plane.style.opacity = String(air);
      routes.style.opacity = String(smooth(ramp(t, 14.4, 14.9)));

      // Powiadomienie podczas śledzenia.
      const nIn = easeOut(ramp(t, 18.7, 19.3));
      const nOut = ramp(t, 23.0, 23.4);
      notif.style.transform = `translateY(${(1 - nIn) * -40}px)`;
      show(notif, nIn * (1 - nOut));
      const next = data.journey.stops[Math.min(journeyStop, data.journey.stops.length - 1)];
      nBody.textContent = NOTIFY.nextStop(next.name);
      nTitle.textContent = NOTIFY.alightAt(dest.name);
      nBar.style.width = `${(journeyProgress * 100).toFixed(1)}%`;

      // Obietnica.
      show(promise, 1 - ramp(t, S.end - 0.3, S.end + 0.1));
      promiseSpans.forEach((span, i) => {
        const k = easeOut(ramp(t, S.promise + 0.4 + i * 0.75, S.promise + 1.0 + i * 0.75));
        span.style.transform = `translateY(${(1 - k) * 112}%)`;
      });

      // Plansza końcowa: znak rysuje się jak linia na mapie.
      const e = S.end;
      show(end, ramp(t, e, e + 0.2));
      const bgK = easeOut(ramp(t, e + 0.1, e + 0.5));
      logoBg.style.transform = `scale(${0.6 + 0.4 * bgK})`;
      logoBg.style.opacity = String(bgK);
      strokes.forEach((s, i) => {
        const k = easeInOut(ramp(t, e + 0.35 + i * 0.22, e + 0.85 + i * 0.22));
        s.style.strokeDashoffset = String(1 - k);
        s.style.opacity = k > 0 ? '1' : '0';
      });
      const nodeK = easeOut(ramp(t, e + 0.5, e + 0.8));
      node.style.transform = `scale(${nodeK})`;
      const stopK = easeOut(ramp(t, e + 1.05, e + 1.3));
      stop.style.transform = `scale(${stopK})`;
      arrow.style.opacity = String(ramp(t, e + 0.95, e + 1.2));
      const nameK = easeOut(ramp(t, e + 1.1, e + 1.6));
      name.style.opacity = String(nameK);
      name.style.transform = `translateY(${(1 - nameK) * 20}px)`;
      reveal(endSpans, t, e + 1.4, 0.14, 0.65);
      const metaK = easeOut(ramp(t, e + 2.0, e + 2.6));
      meta.style.opacity = String(metaK);

      show(attrib, visible(t, 0, S.promise + 0.2, 0.4));
      show(liveNote, visible(t, S.live + 0.4, S.poland, 0.4));
    },
  };
}
