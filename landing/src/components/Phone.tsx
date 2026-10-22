import { useLayoutEffect, useRef } from 'react';
import {
  Bell,
  BusFront,
  ChevronRight,
  GraduationCap,
  History,
  LocateFixed,
  MapPin,
  TramFront,
} from 'lucide-react';
import { getLineColors } from '../../../src/services/lineIdentity';
import { cityNames } from '../../../src/i18n/landing/cities';
import { useStrings } from '../i18n';
import { Clock3, Dumbbell, Home, Search, Settings2 } from './phoneIcons';
import './phone.css';

const nativeWidth = 393;

function LineBadge({ line }: { line: string }) {
  const colors = getLineColors(line, undefined, 'wroclaw');
  const Icon = colors.isTram ? TramFront : BusFront;
  return (
    <span
      className="native-home-line-badge"
      style={{ backgroundColor: colors.bg, color: colors.fg }}
    >
      <Icon size={13} />
      <span>{line}</span>
    </span>
  );
}

export function Phone({ className = '' }: { className?: string }) {
  const s = useStrings().homePreview;
  const screen = useRef<HTMLDivElement>(null);
  const places = [
    { Icon: Home, name: s.home, address: s.places.homeAddress },
    { Icon: GraduationCap, name: s.places.school, address: s.school },
    { Icon: Dumbbell, name: s.gym, address: s.places.gymAddress },
  ];
  const recent = [
    {
      Icon: GraduationCap,
      name: s.places.school,
      address: s.school,
      kind: 'saved',
      minutes: 3,
      line: s.places.lines.school,
    },
    {
      Icon: BusFront,
      name: s.places.station,
      address: s.stop,
      kind: 'stop',
      minutes: 5,
      line: s.places.lines.station,
    },
    {
      Icon: BusFront,
      name: s.places.bridge,
      address: s.stop,
      kind: 'stop',
      minutes: 8,
      line: s.places.lines.bridge,
    },
    { Icon: Clock3, name: s.places.history, address: s.stop, kind: 'history' },
  ];

  useLayoutEffect(() => {
    const element = screen.current;
    if (!element) return;
    const resize = (width: number) => {
      element.style.setProperty('--phone-scale', String(width / nativeWidth));
    };
    resize(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) resize(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`phone ${className}`} role="img" aria-label={s.screenLabel}>
      <div className="iphone-hardware" aria-hidden="true">
        <span className="iphone-button iphone-button-action" />
        <span className="iphone-button iphone-button-volume-up" />
        <span className="iphone-button iphone-button-volume-down" />
        <span className="iphone-button iphone-button-power" />
      </div>
      <div className="phone-screen" ref={screen} aria-hidden="true">
        <div className="native-home" aria-hidden="true">
          <div className="iphone-status-bar">
            <span className="iphone-time">{s.statusTime}</span>
            <div className="iphone-status-icons">
              <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
                <rect x="0" y="8" width="3" height="4" rx="0.8" />
                <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
                <rect x="10" y="3" width="3" height="9" rx="0.8" />
                <rect x="15" width="3" height="12" rx="0.8" />
              </svg>
              <svg width="17" height="13" viewBox="0 0 17 13" fill="none">
                <path
                  d="M1 3.5a11.5 11.5 0 0 1 15 0M3.7 6.5a7.4 7.4 0 0 1 9.6 0M6.5 9.4a3.2 3.2 0 0 1 4 0"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="8.5" cy="12" r="1" fill="currentColor" />
              </svg>
              <svg width="27" height="13" viewBox="0 0 27 13" fill="currentColor">
                <rect
                  x="0.5"
                  y="0.5"
                  width="23"
                  height="12"
                  rx="3.5"
                  fill="none"
                  stroke="currentColor"
                  opacity="0.5"
                />
                <rect x="2.5" y="2.5" width="19" height="8" rx="1.5" />
                <path d="M25 4v5a2.7 2.7 0 0 0 0-5" opacity="0.5" />
              </svg>
            </div>
          </div>
          <div className="iphone-island">
            <span className="iphone-camera" />
          </div>
          <div className="native-home-content">
            <div className="native-home-body">
              <div className="native-home-topbar">
                <div className="native-home-city">
                  <MapPin size={16} />
                  <span>{cityNames.wroclaw}</span>
                </div>
                <div className="native-home-actions">
                  <div className="native-home-action">
                    <Bell size={20} />
                  </div>
                  <div className="native-home-action">
                    <Settings2 size={20} />
                  </div>
                </div>
              </div>
              <div className="native-home-title">{s.title}</div>
              <div className="native-home-saved">
                <div className="native-home-section-header">
                  <span>{s.savedTitle}</span>
                  <span className="native-home-edit">{s.edit}</span>
                </div>
                <div className="native-home-places">
                  {places.map(({ Icon, name, address }) => (
                    <div className="native-home-place" key={name}>
                      <div className="native-home-place-icon">
                        <Icon size={24} />
                      </div>
                      <div className="native-home-place-text">
                        <span className="native-home-place-name">{name}</span>
                        <span className="native-home-place-address">{address}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="native-home-history">
                <div className="native-home-history-header">
                  <History size={16} />
                  <span>{s.historyTitle}</span>
                </div>
                <div className="native-home-history-list">
                  {recent.map(({ Icon, name, address, kind, minutes, line }) => (
                    <div className="native-home-history-row" key={name}>
                      <div className={`native-home-history-icon native-home-history-icon-${kind}`}>
                        <Icon size={19} />
                      </div>
                      <div className="native-home-history-text">
                        <span className="native-home-history-name">{name}</span>
                        <span className="native-home-history-address">{address}</span>
                      </div>
                      <div className="native-home-departure-slot">
                        {minutes !== undefined && line && (
                          <div className="native-home-departure">
                            <span className="native-home-badge-slot">
                              <LineBadge line={line} />
                            </span>
                            <span>{s.departIn(minutes)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="native-home-dock">
            <div className="native-home-search">
              <Search size={20} />
              <span>{s.searchLabel}</span>
            </div>
            <div className="native-home-origin">
              <LocateFixed size={18} />
              <span>{s.startFrom(s.places.origin)}</span>
              <ChevronRight size={16} />
            </div>
          </div>
          <div className="iphone-home-indicator" />
        </div>
      </div>
    </div>
  );
}
