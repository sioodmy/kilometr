import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Briefcase,
  BusFront,
  Check,
  ChevronRight,
  Footprints,
  History,
  Home,
  LocateFixed,
  MapPin,
  Navigation,
  Pencil,
  Search,
  Settings2,
  Signal,
  TramFront,
  Wifi,
  BatteryFull,
} from 'lucide-react';
import { useStrings } from '../i18n';

export type Screen = 'home' | 'routes' | 'trip';

function Line({ children = '23' }: { children?: string }) {
  return (
    <span className="app-line">
      <TramFront />
      {children}
    </span>
  );
}

function HomeScreen() {
  const s = useStrings().preview;
  return (
    <>
      <div className="app-toolbar">
        <span>
          <MapPin />
          {s.city}
        </span>
        <div>
          <Bell />
          <Settings2 />
        </div>
      </div>
      <div className="app-home-title">{s.title}</div>
      <div className="app-section-label">
        <History />
        {s.history}
      </div>
      <div className="app-recent">
        {[
          { name: s.station, icon: BusFront, time: 5, line: '23' },
          { name: s.market, icon: BusFront, time: 8, line: '5' },
          { name: s.square, icon: MapPin, time: 12, line: '3' },
        ].map(({ name, icon: Icon, time, line }) => (
          <div className="app-recent-row" key={name}>
            <span className="app-place-icon">
              <Icon />
            </span>
            <span className="app-place-name">
              <b>{name}</b>
              <small>{s.stop}</small>
            </span>
            <span className="app-departure">
              <Line>{line}</Line>
              <small>{s.inMinutes(time)}</small>
            </span>
          </div>
        ))}
      </div>
      <div className="app-section-label app-saved-label">{s.saved}</div>
      <div className="app-saved">
        <div>
          <Home />
          <b>{s.homePlace}</b>
          <small>{s.homeAddress}</small>
        </div>
        <div>
          <Briefcase />
          <b>{s.workPlace}</b>
          <small>{s.workAddress}</small>
        </div>
        <div className="app-edit">
          <Pencil />
          <small>{s.edit}</small>
        </div>
      </div>
      <div className="app-search">
        <div>
          <Search />
          <b>{s.search}</b>
        </div>
        <div>
          <span>{s.from}</span>
          <LocateFixed />
        </div>
      </div>
    </>
  );
}

function RoutesScreen() {
  const s = useStrings().preview;
  return (
    <>
      <div className="app-toolbar">
        <span>
          <ArrowLeft />
          {s.connections}
        </span>
        <Settings2 />
      </div>
      <div className="app-endpoints">
        <span>
          <i />
          {s.location}
        </span>
        <span>
          <i />
          {s.station}
        </span>
      </div>
      <div className="app-section-label">{s.connections}</div>
      {[
        { time: 8, departure: '09:27', arrival: '09:34', duration: 7 },
        { time: 16, departure: '09:35', arrival: '09:42', duration: 7 },
        { time: 23, departure: '09:42', arrival: '09:51', duration: 9 },
      ].map((route) => (
        <div className="app-route" key={route.time}>
          <div className="app-route-heading">
            <b>{s.inMinutes(route.time)}</b>
            <span>{s.minutes(route.duration)}</span>
          </div>
          <p>
            {route.departure}
            <ArrowRight />
            {route.arrival}
          </p>
          <div className="app-route-line">
            <Footprints />
            <Line />
            <span>{s.destination}</span>
          </div>
          <small>{s.direct}</small>
        </div>
      ))}
      <div className="app-route-bottom">
        <TramFront />
        <BusFront />
        <History />
        <Settings2 />
      </div>
    </>
  );
}

function TripScreen() {
  const s = useStrings().preview;
  return (
    <>
      <div className="app-toolbar">
        <span>
          <ArrowLeft />
          {s.connection}
        </span>
        <Navigation />
      </div>
      <div className="app-trip-map" aria-hidden="true">
        <svg viewBox="0 0 300 210" className="app-streets">
          <path d="M0 50 300 130M0 160 300 50M40 0 120 210M130 0 210 210M280 0 170 210M0 195 300 160" />
          <path className="app-river" d="M0 70Q100 190 180 60T320 90" />
          <path className="app-map-route" d="M74 168 116 144 152 126 172 82 217 57" />
          <circle cx="74" cy="168" r="6" />
          <circle cx="152" cy="126" r="6" />
          <circle cx="217" cy="57" r="6" />
        </svg>
        <span className="app-map-label">{s.gallery}</span>
        <span className="app-map-vehicle">
          <TramFront />
        </span>
      </div>
      <div className="app-trip-summary">
        <Line />
        <span>
          <small>{s.direction}</small>
          <b>{s.destination}</b>
        </span>
        <ChevronRight />
      </div>
      <div className="app-trip-times">
        <div>
          <small>{s.depart}</small>
          <b>09:27</b>
        </div>
        <ArrowRight />
        <div>
          <small>{s.arrival}</small>
          <b>09:34</b>
        </div>
        <span>{s.minutes(7)}</span>
      </div>
      <div className="app-itinerary">
        <div>
          <span>
            <Footprints />
          </span>
          <p>
            <b>{s.walk}</b>
            <small>{s.market}</small>
          </p>
        </div>
        <div>
          <span>
            <TramFront />
          </span>
          <p>
            <b>{s.board}</b>
            <small>{s.destination}</small>
          </p>
        </div>
        <div>
          <span>
            <Check />
          </span>
          <p>
            <b>{s.arrive}</b>
            <small>{s.station}</small>
          </p>
        </div>
      </div>
      <div className="app-trip-footer">
        <Navigation />
        {s.stops}
        <ChevronRight />
      </div>
    </>
  );
}

export function Phone({
  screen = 'home',
  className = '',
}: {
  screen?: Screen;
  className?: string;
}) {
  const s = useStrings().preview;
  return (
    <div className={`phone ${className}`} role="img" aria-label={s[screen]}>
      <div className="phone-screen" aria-hidden="true">
        <div className="app-status">
          <span>9:19</span>
          <span>
            <Signal />
            <Wifi />
            <BatteryFull />
          </span>
        </div>
        <div className="phone-camera" />
        <div className="app-content">
          {screen === 'home' ? (
            <HomeScreen />
          ) : screen === 'routes' ? (
            <RoutesScreen />
          ) : (
            <TripScreen />
          )}
        </div>
        <div className="app-gesture" />
      </div>
    </div>
  );
}
