export type Screen = 'home' | 'routes' | 'trip';

export const SCREENSHOT_SIZE = { width: 720, height: 1500 };

export const SCREENSHOTS: Record<Screen, string | null> = {
  home: './screenshots/home.png',
  routes: './screenshots/routes.png',
  trip: './screenshots/trip.png',
};
