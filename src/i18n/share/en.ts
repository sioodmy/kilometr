import type { ShareStrings } from './pl';

export const en: ShareStrings = {
  title: 'Share journey',
  subtitle: 'Let someone know how you’re travelling and when you’ll arrive.',
  brand: 'Kilometr', arrival: 'Arriving', departure: 'Departure', from: 'From', to: 'To',
  duration: (n) => `${n} min`,
  transfers: (n) => n === 0 ? 'Direct' : n === 1 ? '1 transfer' : `${n} transfers`,
  walk: 'Walk', walkDistance: (n) => `${n} m walk`,
  modes: { walk: 'Walk', tram: 'Tram', bus: 'Bus', train: 'Train', cable: 'Cable car', trolleybus: 'Trolleybus', subway: 'Metro' },
  direction: (name) => `Towards ${name}`,
  cardLabel: (from, to, at) => `Journey from ${from} to ${to}, arriving at ${at}`,
  imageAndLink: 'Share card and link', linkOnly: 'Share link', sms: 'Send SMS', copy: 'Copy link', copied: 'Link copied',
  preparing: 'Preparing your card…',
  error: 'Could not share. Try again or copy the link.',
  smsError: 'Could not open SMS. Copy the link and paste it into a message.',
  close: 'Close',
  message: (from, to, departure, arrival, lines) =>
    `I’m travelling from ${from} to ${to}${lines ? ` (${lines})` : ''}. Leaving at ${departure}, arriving at ${arrival}.`,
  snapshot: 'Journey plan at the time of sharing. Location and delays do not update.',
  privacy: 'The link contains your route and times. Anyone you send it to can open it.',
  pageTitle: 'Shared journey', itinerary: 'Journey details', loading: 'Loading scheduled stops…',
  stopsUnavailable: 'Stop details are unavailable. Shared times and transfers are shown above.',
  retry: 'Reload stops', showStops: (n) => `Show stops (${n})`, timetable: 'Static timetable',
  invalidTitle: 'Cannot open this journey',
  invalidBody: 'The link is incomplete or damaged. Ask for the journey to be shared again.',
  home: 'Kilometr website', dayLater: (n) => `+${n} d`,
};
