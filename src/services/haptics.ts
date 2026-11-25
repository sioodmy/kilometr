import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

function performAndroid(effect: Haptics.AndroidHaptics, fallback?: () => Promise<void>) {
  void Haptics.performAndroidHapticsAsync(effect).catch(() => {
    if (fallback) {
      void fallback().catch(() => {});
    }
  });
}

/** Krótki klik dotykowy przy otwieraniu karty lub akcji głównej. */
export function hapticTap() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    performAndroid(Haptics.AndroidHaptics.Context_Click, () =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Delikatny tick wyboru dla chipów, przełączników i przycisków pomocniczych. */
export function hapticSelection() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    performAndroid(Haptics.AndroidHaptics.Clock_Tick, () => Haptics.selectionAsync());
    return;
  }
  void Haptics.selectionAsync().catch(() => {});
}

/** Wyraźne kliknięcie przy przekroczeniu progu gestu (uzbrojenie akcji). */
export function hapticGestureArm() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    performAndroid(Haptics.AndroidHaptics.Gesture_Start, () =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
    );
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Subtelny tick zwrotny przy cofnięciu palca poniżej progu gestu. */
export function hapticGestureDisarm() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    performAndroid(Haptics.AndroidHaptics.Segment_Frequent_Tick);
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

/** Sygnał wejścia w podgląd po przytrzymaniu karty. */
export function hapticLongPress() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    performAndroid(Haptics.AndroidHaptics.Long_Press, () =>
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
    );
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

/** Miękkie potwierdzenie udanego wczytania danych po geście. */
export function hapticSuccess() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    performAndroid(Haptics.AndroidHaptics.Confirm, () =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    );
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

/** Delikatne wyczucie granicy (np. brak wcześniejszych kursów tego dnia). */
export function hapticEdge() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    performAndroid(Haptics.AndroidHaptics.Segment_Tick);
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {});
}

/** Sygnał niepowodzenia akcji inicjowanej przez użytkownika. */
export function hapticError() {
  if (Platform.OS === 'web') return;
  if (Platform.OS === 'android') {
    performAndroid(Haptics.AndroidHaptics.Reject, () =>
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    );
    return;
  }
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
