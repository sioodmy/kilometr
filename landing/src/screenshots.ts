export type Screen = 'home' | 'routes' | 'trip';

export const SCREENSHOT_SIZE = { width: 1080, height: 2400 };

export const SCREENSHOTS: Record<Screen, string | null> = {
  home: null,
  routes: null,
  trip: null,
};
