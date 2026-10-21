import { useEffect, useId, useRef, useState } from 'react';

const routes = [
  'M-80 150H160Q180 150 195 165L385 355Q400 370 420 370H980Q1000 370 1015 355L1240 130Q1255 115 1275 115H1480',
  'M-80 510H200Q220 510 235 495L430 300Q445 285 465 285H955Q975 285 990 300L1230 540Q1245 555 1265 555H1480',
  'M180-60V195Q180 215 195 230L430 465Q445 480 445 500V770Q445 790 460 805L710 1055Q725 1070 745 1070H1480',
  'M1245-60V210Q1245 230 1230 245L1030 445Q1015 460 1015 480V790Q1015 810 1000 825L780 1045Q765 1060 765 1080V1320',
  'M-80 800H210Q230 800 245 785L360 670Q375 655 395 655H1010Q1030 655 1045 640L1150 535Q1165 520 1185 520H1480',
  'M-80 1030H130Q150 1030 165 1015L345 835Q360 820 380 820H1085Q1105 820 1120 835L1300 1015Q1315 1030 1335 1030H1480',
  'M-80 1350H240Q260 1350 275 1365L510 1600Q525 1615 545 1615H1080Q1100 1615 1115 1600L1300 1415Q1315 1400 1335 1400H1480',
  'M180 1100V1630Q180 1650 195 1665L410 1880Q425 1895 425 1915V2700',
  'M1245 1100V1630Q1245 1650 1230 1665L1010 1885Q995 1900 995 1920V2700',
  'M-80 2100H230Q250 2100 265 2085L460 1890Q475 1875 495 1875H1040Q1060 1875 1075 1890L1270 2085Q1285 2100 1305 2100H1480',
  'M-80 2440H320Q340 2440 355 2425L550 2230Q565 2215 585 2215H920Q940 2215 955 2230L1150 2425Q1165 2440 1185 2440H1480',
];

const journeyRoute =
  'M765 1080V1240Q765 1260 750 1275L510 1515Q495 1530 495 1550V1630Q495 1650 510 1665L865 2020Q880 2035 880 2055V2185Q880 2205 865 2220L715 2370Q700 2385 700 2405V2700';
const stations = [
  [180, 150],
  [285, 255],
  [530, 370],
  [1100, 270],
  [330, 400],
  [1070, 380],
  [445, 580],
  [1015, 715],
  [270, 760],
  [1170, 520],
  [550, 820],
  [1210, 925],
  [180, 1420],
  [355, 1445],
  [750, 1615],
  [1245, 1510],
  [425, 2030],
  [995, 2270],
  [360, 1990],
  [1125, 1940],
  [700, 2215],
  [1110, 2385],
];

const mobileRoutes = [
  'M112-40V280Q112 296 124 308L228 412Q240 424 240 440V760Q240 776 228 788L124 892Q112 904 112 920V1360Q112 1376 124 1388L228 1492Q240 1504 240 1520V1920Q240 1936 252 1948L356 2052Q368 2064 368 2080V3040',
  'M368-40V190Q368 206 356 218L252 322Q240 334 240 350V540Q240 556 252 568L356 672Q368 684 368 700V1280Q368 1296 356 1308L252 1412Q240 1424 240 1440V1660Q240 1676 228 1688L124 1792Q112 1804 112 1820V3040',
  'M-40 1100H160Q176 1100 188 1112L292 1216Q304 1228 320 1228H520',
  'M-40 2340H144Q160 2340 172 2328L308 2192Q320 2180 336 2180H520',
];
const mobileJourneyRoute =
  'M240 1160V1280Q240 1296 228 1308L92 1444Q80 1456 80 1472V1740Q80 1756 92 1768L388 2064Q400 2076 400 2092V2320Q400 2336 388 2348L252 2484Q240 2496 240 2512V3040';
const mobileStations = [
  [112, 160],
  [240, 600],
  [112, 1080],
  [240, 1640],
  [368, 2280],
  [368, 140],
  [368, 920],
  [112, 2160],
  [112, 2660],
  [80, 1100],
  [400, 1228],
  [88, 2340],
  [400, 2180],
];

export function TransitBackdrop() {
  const backdrop = useRef<HTMLDivElement>(null);
  const id = useId();
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const network = mobile ? mobileRoutes : routes;
  const route = mobile ? mobileJourneyRoute : journeyRoute;
  const stops = mobile ? mobileStations : stations;
  const trains = mobile ? [0, 1, 2] : [0, 2, 4, 6, 9];

  useEffect(() => {
    const element = backdrop.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrow = window.matchMedia('(max-width: 767px)');
    const resize = () => setMobile(narrow.matches);
    let visible = false;
    const update = () => {
      element.dataset.motion =
        visible && !document.hidden && !reduced.matches ? 'running' : 'paused';
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    reduced.addEventListener('change', update);
    narrow.addEventListener('change', resize);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
      reduced.removeEventListener('change', update);
      narrow.removeEventListener('change', resize);
    };
  }, []);

  return (
    <div className="transit-backdrop" ref={backdrop} aria-hidden="true">
      <svg
        viewBox={mobile ? '0 0 480 3000' : '0 0 1400 2600'}
        preserveAspectRatio="xMidYMin slice"
        fill="none"
      >
        <defs>
          {network.map((route, index) => (
            <path id={`${id}-${index}`} d={route} pathLength="1000" key={route} />
          ))}
          <path id={`${id}-journey`} d={route} pathLength="1" />
        </defs>
        <g className="transit-network">
          {network.map((route, index) => (
            <use href={`#${id}-${index}`} key={route} />
          ))}
          <use href={`#${id}-journey`} />
        </g>
        <g className="transit-stations">
          {stops.map(([x, y]) => (
            <circle cx={x} cy={y} r="4" key={`${x}-${y}`} />
          ))}
        </g>
        <g className="transit-trains">
          {trains.map((index) => (
            <use className="transit-train" href={`#${id}-${index}`} key={index} />
          ))}
        </g>
        <use className="transit-journey-progress" href={`#${id}-journey`} />
        <use className="transit-journey-cursor" href={`#${id}-journey`} />
      </svg>
    </div>
  );
}
