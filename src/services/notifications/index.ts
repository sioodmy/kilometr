// Publiczne API powiadomień. Reszta katalogu to wnętrze — importujemy tylko
// stąd, żeby nie mieszać warstw (np. ekran nie powinien wiedzieć, na jakim
// kanale leci alert).

export type {
  NativeTrackingState,
  NotificationPreferences,
  TripActivityProps,
  TripLinkParams,
  TripPhase,
  TripProgress,
  TrackedTrip,
} from './types';
export { DEFAULT_NOTIFICATION_PREFERENCES } from './types';

export {
  ALERTS_CHANNEL_ID,
  TRACKING_CHANNEL_ID,
  setupNotificationChannels,
} from './channels';
export {
  ACTION_OPEN_ROUTES,
  ACTION_STOP,
  ALERT_CATEGORY,
  TRIP_CATEGORY,
  setupNotificationCategories,
} from './categories';
export { setupNotificationHandler, setupNotifications } from './setup';
export {
  areNotificationsSupported,
  isNativeTrackingSupported,
  TRACKING_NOTIFICATION_ID,
} from './module';
export {
  ensureNotificationPermission,
  hasNotificationPermission,
  isDynamicIslandPlatform,
  permissionDeniedMessage,
} from './permissions';
export {
  getNotificationPreferencesSync,
  loadNotificationPreferences,
  saveNotificationPreferences,
  useNotificationPreferences,
} from './preferences';
export {
  dismissTracking,
  presentTrip,
} from './presenter';
export {
  addTripResponseListener,
  getLastTripResponse,
  openTripLink,
  type TripResponse,
} from './response';
export { computeTripProgress } from './tripProgress';
export { matchTrackedConnection } from './tripMonitor';
export { buildActivityProps, buildTripCopy, buildTripLink, type TripCopy } from './content';
export {
  getTrackedTripSync,
  getTripProgressSync,
  isSameQuery,
  refreshTrackedTrip,
  restoreTrackedTrip,
  startTracking,
  startTrackedTripListener,
  stopTracking,
  subscribeTracked,
} from './tripMonitor';
export {
  countdownText,
  delayText,
  formatClock,
  formatDistance,
  minutesText,
  plural,
  toAbsoluteMs,
  untilText,
} from './format';
export {
  hasActiveTripActivity,
  isLiveActivitySupported,
} from './liveActivity/controller';
export { useTrackedTrip } from './useTrackedTrip';
export { TRIP_ACTIVITY_NAME } from './liveActivity/KilometrTripActivity';
