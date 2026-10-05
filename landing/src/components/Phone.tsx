import {
  BatteryFull,
  Bell,
  ChevronDown,
  Clock3,
  Crosshair,
  Home,
  Plus,
  Search,
  Settings2,
  Signal,
  Wifi,
} from 'lucide-react';
import { CONFIRMED } from '../data';

// Ekran główny przepisany 1:1 ze screena pr-45 (ciemny M3, teal #5CDBBE).
// Skala pomniejszona pod mockup, ale hierarchia i napisy jak w aplikacji.
export function AppMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-status">
        <span className="mock-time">9:44</span>
        <span className="mock-sicons">
          <Signal size={11} strokeWidth={2.2} />
          <Wifi size={11} strokeWidth={2.2} />
          <BatteryFull size={13} strokeWidth={2} />
        </span>
      </div>

      <div className="mock-top">
        <div className="mock-origin">
          <Crosshair size={13} strokeWidth={2.2} />
          <span>{CONFIRMED.originLabel}</span>
          <ChevronDown size={13} strokeWidth={2.2} />
        </div>
        <div className="mock-ibtn">
          <Bell size={13} strokeWidth={2.2} />
        </div>
        <div className="mock-ibtn">
          <Settings2 size={13} strokeWidth={2.2} />
        </div>
      </div>

      <p className="mock-h1">{CONFIRMED.homeTitle}</p>

      <div className="mock-sect">
        <span>{CONFIRMED.savedTitle}</span>
      </div>
      <div className="mock-saved">
        <div className="mock-place">
          <span className="mock-pic">
            <Home size={15} strokeWidth={2.2} />
          </span>
          <b>Dom</b>
          <i>Przystanek</i>
        </div>
        <div className="mock-place mock-add">
          <span className="mock-pic">
            <Plus size={15} strokeWidth={2.4} />
          </span>
          <b>Dodaj</b>
          <i>własne miejsce</i>
        </div>
      </div>

      <div className="mock-sect mock-recent">
        <Clock3 size={12} strokeWidth={2.4} />
        <span>{CONFIRMED.recentTitle}</span>
      </div>
      <div className="mock-list">
        {CONFIRMED.recent.map((r) => (
          <div className="mock-row" key={r.name}>
            <span className="mock-ric">
              <Clock3 size={14} strokeWidth={2.2} />
            </span>
            <span className="mock-rmain">
              <b>{r.name}</b>
              <i>{r.sub}</i>
            </span>
            <span className="mock-reta">
              <b>{r.eta}</b>
              <i>{r.dep}</i>
            </span>
          </div>
        ))}
      </div>

      <div className="mock-thumb">
        <span className="mock-chip">
          <Home size={13} strokeWidth={2.4} />
          Dom
        </span>
        <span className="mock-ask">
          <Search size={13} strokeWidth={2.4} />
          {CONFIRMED.searchHint}
        </span>
      </div>
    </div>
  );
}

// Google Pixel (front): tytanowa ramka, fizyczne przyciski, punch-hole,
// zaokrąglenie 9:19.5. Czysty CSS — bez zdjęć stockowych.
export function PixelPhone() {
  return (
    <div className="pixel-wrap">
      <div className="pixel-glow" aria-hidden="true" />
      <div className="pixel">
        <span className="pixel-btn pixel-btn-power" aria-hidden="true" />
        <span className="pixel-btn pixel-btn-vol" aria-hidden="true" />
        <div className="pixel-screen">
          <span className="pixel-camera" aria-hidden="true" />
          <AppMock />
        </div>
      </div>
      <p className="pixel-caption">Ekran główny — poglądowy układ aplikacji</p>
    </div>
  );
}
