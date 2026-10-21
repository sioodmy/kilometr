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
    <div className={`phone ${className}`}>
      <div className="phone-screen" ref={screen} role="img" aria-label={s.screenLabel}>
        <div className="native-home" aria-hidden="true">
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
        </div>
      </div>
    </div>
  );
}
