// Publiczne API powiadomień. Reszta katalogu to wnętrze — importujemy tylko
// stąd, żeby nie mieszać warstw (np. ekran nie powinien wiedzieć, na jakim
// kanale leci alert).

export type {
  LivePlan,
  LivePlanPhaseCopy,
  LivePlanSegment,
  NotificationPreferences,
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
  getTrackingNative,
  isNativeTrackingSupported,
  TRACKING_NOTIFICATION_ID,
} from './module';
export {
  canShowLiveUpdates,
  ensureNotificationPermission,
  hasNotificationPermission,
  isTrackingPlatform,
  permissionDeniedMessage,
} from './permissions';
export {
  getNotificationPreferencesSync,
  loadNotificationPreferences,
  saveNotificationPreferences,
  useNotificationPreferences,
} from './preferences';
export { dismissTracking, presentTrip } from './presenter';
export { addTripResponseListener, getLastTripResponse, type TripResponse } from './response';
export { computeTripProgress, computeLegTimeline, type LegTimelineEntry } from './tripProgress';
export { matchTrackedConnection } from './planMatch';
export {
  buildLivePlan,
  buildLivePlanJson,
  buildPhaseCopy,
  buildSegments,
  buildTripCopy,
  buildTripLink,
  tripNotificationData,
  WALK_SEGMENT_COLOR,
  type BuildPlanOptions,
  type TripCopy,
} from './content';
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
  clockFromMs,
  formatClock,
  formatDistance,
  toAbsoluteMs,
} from './format';
export { useTrackedTrip } from './useTrackedTrip';