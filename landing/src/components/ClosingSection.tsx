import { useEffect, useRef } from 'react';
import { Coffee } from 'lucide-react';
import { COFFEE_URL } from '../data';
import { useStrings } from '../i18n';
import { PlatformLinks } from './PlatformLinks';

const NETWORK_WIDTH = 1200;
const NETWORK_HEIGHT = 720;

// Rozkład węzłów w viewBoxie, gęściej przy krawędziach, żeby nie przeszkadzał w czytaniu.
const NETWORK_NODES = [
  { x: 88, y: 150, hub: true },
  { x: 190, y: 76, hub: false },
  { x: 238, y: 232, hub: false },
  { x: 104, y: 322, hub: false },
  { x: 196, y: 432, hub: false },
  { x: 92, y: 586, hub: false },
  { x: 262, y: 636, hub: true },
  { x: 1114, y: 138, hub: true },
  { x: 1004, y: 70, hub: false },
  { x: 1056, y: 248, hub: false },
  { x: 1128, y: 336, hub: false },
  { x: 1012, y: 458, hub: false },
  { x: 1104, y: 574, hub: false },
  { x: 912, y: 626, hub: true },
  { x: 500, y: 68, hub: false },
  { x: 706, y: 104, hub: false },
  { x: 486, y: 654, hub: false },
  { x: 742, y: 646, hub: false },
  { x: 330, y: 330, hub: false },
  { x: 870, y: 300, hub: false },
  { x: 352, y: 512, hub: false },
  { x: 858, y: 512, hub: false },
] as const;

const NETWORK_LINKS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [2, 3],
  [2, 4],
  [3, 5],
  [4, 5],
  [4, 6],
  [5, 6],
  [2, 18],
  [4, 18],
  [18, 20],
  [20, 16],
  [6, 16],
  [18, 14],
  [7, 8],
  [7, 9],
  [8, 9],
  [9, 10],
  [9, 11],
  [10, 12],
  [11, 12],
  [11, 13],
  [12, 13],
  [9, 19],
  [11, 19],
  [21, 19],
  [21, 17],
  [21, 13],
  [17, 16],
  [14, 15],
  [15, 7],
  [18, 19],
] as const;

const NETWORK_ROUTES: ReadonlyArray<readonly [number, number]> = [
  [2, 18],
  [15, 7],
  [17, 16],
  [21, 11],
] as const;

export function ClosingSection() {
  const s = useStrings();
  const cardRef = useRef<HTMLDivElement>(null);

  // Podświetlamy tylko najbliższy węzeł i jego bezpośrednie połączenia, bez pokazywania całego grafu.
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const nodeElements = Array.from(card.querySelectorAll<SVGGElement>('.closing-net-node'));
    const lineElements = Array.from(card.querySelectorAll<SVGLineElement>('.closing-net-line'));
    const routeElements = Array.from(card.querySelectorAll<SVGLineElement>('.closing-net-route'));
    const incident = NETWORK_NODES.map(() => [] as number[]);
    NETWORK_LINKS.forEach(([a, b], index) => {
      incident[a].push(index);
      incident[b].push(index);
    });
    const routeEdges = NETWORK_ROUTES.map(([a, b]) =>
      NETWORK_LINKS.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a)),
    );
    const lineMidpoints = NETWORK_LINKS.map(([a, b]) => {
      const from = NETWORK_NODES[a];
      const to = NETWORK_NODES[b];
      return [(from.x + to.x) / 2, (from.y + to.y) / 2] as const;
    });
    const maxDistance = Math.hypot(NETWORK_WIDTH, NETWORK_HEIGHT);
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    let hasPointer = false;
    let needsReveal = true;

    const toggle = (element: Element, active: boolean) => {
      if (active !== element.classList.contains('is-lit'))
        element.classList.toggle('is-lit', active);
    };

    const clearHighlights = () => {
      nodeElements.forEach((node) => node.classList.remove('is-lit'));
      lineElements.forEach((line) => line.classList.remove('is-lit'));
      routeElements.forEach((route) => route.classList.remove('is-lit'));
    };

    const paint = () => {
      frame = 0;
      const rect = card.getBoundingClientRect();
      if (!hasPointer) {
        clearHighlights();
        card.style.removeProperty('--closing-net-x');
        card.style.removeProperty('--closing-net-y');
        return;
      }
      card.style.setProperty('--closing-glow-x', `${pointerX}px`);
      card.style.setProperty('--closing-glow-y', `${pointerY}px`);
      const shiftX = (pointerX / rect.width - 0.5) * -9;
      const shiftY = (pointerY / rect.height - 0.5) * -7;
      card.style.setProperty('--closing-net-x', `${shiftX.toFixed(2)}px`);
      card.style.setProperty('--closing-net-y', `${shiftY.toFixed(2)}px`);
      const scale = Math.max(rect.width / NETWORK_WIDTH, rect.height / NETWORK_HEIGHT);
      const offsetX = (rect.width - NETWORK_WIDTH * scale) / 2;
      const offsetY = (rect.height - NETWORK_HEIGHT * scale) / 2;
      const graphX = (pointerX - offsetX) / scale;
      const graphY = (pointerY - offsetY) / scale;
      if (needsReveal) {
        needsReveal = false;
        nodeElements.forEach((node, index) => {
          const point = NETWORK_NODES[index];
          const distance = Math.hypot(point.x - graphX, point.y - graphY) / maxDistance;
          node.style.setProperty('--net-delay', `${(distance * 0.9).toFixed(3)}s`);
        });
        lineElements.forEach((line, index) => {
          const [midX, midY] = lineMidpoints[index];
          const distance = Math.hypot(midX - graphX, midY - graphY) / maxDistance;
          line.style.setProperty('--net-delay', `${(distance * 0.9).toFixed(3)}s`);
        });
      }
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      NETWORK_NODES.forEach((node, index) => {
        const distance = Math.hypot(node.x - graphX, node.y - graphY);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      const activeEdges = incident[nearestIndex];
      const activeNodes = new Set<number>([nearestIndex]);
      activeEdges.forEach((index) => {
        const [a, b] = NETWORK_LINKS[index];
        activeNodes.add(a);
        activeNodes.add(b);
      });
      nodeElements.forEach((node, index) => toggle(node, activeNodes.has(index)));
      lineElements.forEach((line, index) => toggle(line, activeEdges.includes(index)));
      routeElements.forEach((route, index) =>
        toggle(route, activeEdges.includes(routeEdges[index])),
      );
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(paint);
    };

    const onMove = (event: PointerEvent) => {
      const rect = card.getBoundingClientRect();
      pointerX = event.clientX - rect.left;
      pointerY = event.clientY - rect.top;
      hasPointer = true;
      schedule();
    };
    const onEnter = (event: PointerEvent) => {
      needsReveal = true;
      onMove(event);
    };
    const onLeave = () => {
      hasPointer = false;
      schedule();
    };

    card.addEventListener('pointerenter', onEnter);
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', onLeave);
    return () => {
      card.removeEventListener('pointerenter', onEnter);
      card.removeEventListener('pointermove', onMove);
      card.removeEventListener('pointerleave', onLeave);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section id="pobierz" className="closing-section" aria-labelledby="closing-title">
      <div ref={cardRef} className="closing section-shell reveal">
        <svg
          className="closing-network"
          viewBox={`0 0 ${NETWORK_WIDTH} ${NETWORK_HEIGHT}`}
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          focusable="false"
        >
          <g className="closing-net-lines">
            {NETWORK_LINKS.map(([a, b], index) => {
              const from = NETWORK_NODES[a];
              const to = NETWORK_NODES[b];
              return (
                <line
                  key={`link-${index}`}
                  className="closing-net-line"
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                />
              );
            })}
          </g>
          <g className="closing-net-routes">
            {NETWORK_ROUTES.map(([a, b], index) => {
              const from = NETWORK_NODES[a];
              const to = NETWORK_NODES[b];
              return (
                <line
                  key={`route-${index}`}
                  className="closing-net-route"
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  pathLength={1}
                  style={{ animationDelay: `${index * 1.7 + 0.8}s` }}
                />
              );
            })}
          </g>
          <g className="closing-net-streaks">
            <line
              className="closing-net-streak"
              x1={NETWORK_NODES[3].x}
              y1={NETWORK_NODES[3].y}
              x2={NETWORK_NODES[14].x}
              y2={NETWORK_NODES[14].y}
              pathLength={1}
              style={{ animationDelay: '0.4s' }}
            />
            <line
              className="closing-net-streak closing-net-streak--alt"
              x1={NETWORK_NODES[1].x}
              y1={NETWORK_NODES[1].y}
              x2={NETWORK_NODES[4].x}
              y2={NETWORK_NODES[4].y}
              pathLength={1}
              style={{ animationDelay: '2.6s' }}
            />
          </g>
          <g className="closing-net-nodes">
            {NETWORK_NODES.map((node, index) => (
              <g
                key={`node-${index}`}
                className={`closing-net-node${node.hub ? ' is-hub' : ''}`}
                transform={`translate(${node.x} ${node.y})`}
              >
                <circle
                  className="closing-net-halo"
                  r={node.hub ? 15 : 9}
                  style={{ animationDelay: `${(index % 7) * 0.6}s` }}
                />
                {node.hub ? (
                  <circle
                    className="closing-net-ring"
                    r={9}
                    style={{ animationDelay: `${index * 0.45}s` }}
                  />
                ) : null}
                <circle className="closing-net-dot" r={node.hub ? 4 : 2.6} />
              </g>
            ))}
          </g>
        </svg>
        <div className="closing-mark" aria-hidden="true">
          <img src="./icon.png" alt="" width={64} height={64} loading="lazy" decoding="async" />
        </div>
        <h2 id="closing-title">{s.closing.title}</h2>
        <p className="section-body">{s.closing.body}</p>
        <div className="closing-actions">
          <PlatformLinks />
          <a
            className="closing-support"
            href={COFFEE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Coffee size={16} aria-hidden="true" />
            <span>{s.closing.support}</span>
          </a>
        </div>
      </div>
    </section>
  );
}
