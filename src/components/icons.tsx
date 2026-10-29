// Material Icons w jednym miejscu. Nazwy zostały te same co wcześniej,
// więc ekrany nie zmieniają się przy wymianie zestawu; mapowanie trzymamy tutaj.
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps, ComponentType } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

type IconProps = {
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  accessible?: boolean;
};

export type IconComponent = ComponentType<IconProps>;

type MaterialName = ComponentProps<typeof MaterialIcons>['name'];

function icon(name: MaterialName): IconComponent {
  function Glyph({ size = 24, color, style, accessible }: IconProps) {
    return (
      <MaterialIcons
        name={name}
        size={size}
        color={color}
        style={style}
        accessible={accessible}
      />
    );
  }
  Glyph.displayName = `Icon(${name})`;
  return Glyph;
}

export const Activity = icon('monitor-heart');
export const AlarmClock = icon('alarm');
export const AlertCircle = icon('error-outline');
export const Anchor = icon('anchor');
export const ArrowDown = icon('arrow-downward');
export const ArrowLeft = icon('arrow-back');
export const ArrowRight = icon('arrow-forward');
export const ArrowUp = icon('arrow-upward');
export const ArrowUpDown = icon('swap-vert');
export const Baby = icon('child-care');
export const Beer = icon('sports-bar');
export const Bell = icon('notifications');
export const BellOff = icon('notifications-off');
export const BellRing = icon('notifications-active');
export const Bike = icon('directions-bike');
export const Briefcase = icon('work');
export const BusFront = icon('directions-bus');
export const CableCar = icon('tram');
export const CarFront = icon('directions-car');
export const Check = icon('check');
export const ChevronDown = icon('expand-more');
export const ChevronLeft = icon('chevron-left');
export const ChevronRight = icon('chevron-right');
export const ChevronUp = icon('expand-less');
export const Church = icon('church');
export const CircleCheck = icon('check-circle');
export const CircleX = icon('cancel');
export const Clapperboard = icon('theaters');
export const Clock3 = icon('schedule');
export const CloudOff = icon('cloud-off');
export const Coffee = icon('local-cafe');
export const Compass = icon('explore');
export const Copy = icon('content-copy');
export const CreditCard = icon('credit-card');
export const Database = icon('storage');
export const DatabaseBackup = icon('backup');
export const Download = icon('download');
export const Dumbbell = icon('fitness-center');
export const ExternalLink = icon('open-in-new');
export const FileDown = icon('file-download');
export const FileUp = icon('file-upload');
export const Film = icon('movie');
export const Flag = icon('flag');
export const Footprints = icon('directions-walk');
export const Fuel = icon('local-gas-station');
export const Gamepad2 = icon('sports-esports');
export const GraduationCap = icon('school');
export const Heart = icon('favorite');
export const History = icon('history');
export const Home = icon('home');
export const Hospital = icon('local-hospital');
export const Hotel = icon('hotel');
export const ImageUp = icon('add-photo-alternate');
export const Landmark = icon('account-balance');
export const Laptop = icon('laptop');
export const Layers = icon('layers');
export const Library = icon('local-library');
export const Link = icon('link');
export const LocateFixed = icon('my-location');
export const MapPin = icon('place');
export const MapPinOff = icon('location-off');
export const MapPinned = icon('map');
export const Maximize2 = icon('fullscreen');
export const MessageCircle = icon('chat-bubble-outline');
export const Minus = icon('remove');
export const Mountain = icon('terrain');
export const Music = icon('music-note');
export const Navigation = icon('navigation');
export const Newspaper = icon('article');
export const Package = icon('inventory-2');
export const PawPrint = icon('pets');
export const Pencil = icon('edit');
export const Pill = icon('medication');
export const Pin = icon('push-pin');
export const Pizza = icon('local-pizza');
export const Plane = icon('flight');
export const Plus = icon('add');
export const Rabbit = icon('cruelty-free');
export const RefreshCw = icon('refresh');
export const RotateCcw = icon('undo');
export const RouteOff = icon('wrong-location');
export const Sandwich = icon('lunch-dining');
export const ScanLine = icon('qr-code-scanner');
export const Scissors = icon('content-cut');
export const Search = icon('search');
export const Settings2 = icon('tune');
export const Share2 = icon('share');
export const ShieldAlert = icon('gpp-bad');
export const ShieldCheck = icon('verified-user');
export const ShieldOff = icon('shield');
export const Ship = icon('directions-boat');
export const ShoppingBag = icon('shopping-bag');
export const ShoppingCart = icon('shopping-cart');
export const SlidersHorizontal = icon('filter-list');
export const Sparkles = icon('auto-awesome');
export const Star = icon('star');
export const Stethoscope = icon('medical-services');
export const Store = icon('storefront');
export const Tent = icon('cottage');
export const Theater = icon('theater-comedy');
export const Ticket = icon('confirmation-number');
export const Train = icon('train');
export const TrainFront = icon('directions-railway');
export const TramFront = icon('tram');
export const Trash2 = icon('delete');
export const Trees = icon('forest');
export const TriangleAlert = icon('warning');
export const Trophy = icon('emoji-events');
export const Turtle = icon('hourglass-empty');
export const University = icon('account-balance');
export const Users = icon('people');
export const Utensils = icon('restaurant');
export const UtensilsCrossed = icon('fastfood');
export const Volume2 = icon('volume-up');
export const Wallpaper = icon('wallpaper');
export const Waves = icon('waves');
export const WifiOff = icon('wifi-off');
export const Wine = icon('wine-bar');
export const X = icon('close');
export const Zap = icon('bolt');
