import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, MapPinOff, Search, X } from './icons';
import { SpringPressable } from './SpringPressable';
import { motion } from '../theme/motion';
import { useEscapeKey, useWebLayout } from '../theme/layout';
import { elev, scheme, shape, type } from '../theme/tokens';
import { useStrings } from '../i18n';
import type { CityDef, CityId } from '../cities';
import { filterCityEntries, getCityEntries, type CityEntry } from '../services/citySearch';

const MAX_RUBBER_UP = 18;

const keyExtractor = (item: CityEntry) => item.city.id;

const CityRow = memo(function CityRow({
  entry,
  active,
  switching,
  disabled,
  onPress,
}: {
  entry: CityEntry;
  active: boolean;
  switching: boolean;
  disabled: boolean;
  onPress: (city: CityDef) => void;
}) {
  const { city, name, feeds } = entry;
  const handlePress = useCallback(() => onPress(city), [onPress, city]);
  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.cityItem,
        active && styles.cityItemActive,
        disabled && !active && styles.cityItemDisabled,
        pressed && !disabled && styles.cityItemPressed,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      accessibilityLabel={`${name}, ${feeds}`}
    >
      <View style={styles.cityItemContent}>
        <Text style={[styles.cityName, active && styles.cityNameActive]}>{name}</Text>
        <Text style={[styles.cityFeeds, active && styles.cityFeedsActive]}>{feeds}</Text>
      </View>

      {switching ? (
        <ActivityIndicator size="small" color={scheme.primary} />
      ) : active ? (
        <Check size={22} color={scheme.onPrimaryContainer} />
      ) : (
        <View style={styles.radioOutline} />
      )}
    </Pressable>
  );
});

export interface CitySelectSheetProps {
  selectedCityId: CityId;
  onSelectCity: (id: CityId) => void;
  onClose: () => void;
  switchingCity?: boolean;
  switchingCityId?: CityId | null;
}

/**
 * Arkusz wyboru miasta M3 Expressive: sprężyste wejście i wyjście, a gest
 * zamykania siedzi na uchwycie i nagłówku, żeby FlatList przewijał się natywnie.
 */
export function CitySelectSheet({
  selectedCityId,
  onSelectCity,
  onClose,
  switchingCity,
  switchingCityId,
}: CitySelectSheetProps) {
  const [query, setQuery] = useState('');
  const s = useStrings();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const webLayout = useWebLayout();
  const { height: windowHeight } = useWindowDimensions();

  const [overlayHeight, setOverlayHeight] = useState(windowHeight);
  const maxOverlayHeightRef = useRef(windowHeight);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const selectRef = useRef(onSelectCity);
  selectRef.current = onSelectCity;
  const selectedRef = useRef(selectedCityId);
  selectedRef.current = selectedCityId;
  const switchingRef = useRef(switchingCity);
  switchingRef.current = switchingCity;
  const closingRef = useRef(false);

  const baseHeight = Math.max(windowHeight, maxOverlayHeightRef.current);
  const effectiveHeight = Platform.OS === 'web' ? overlayHeight : baseHeight;
  const targetSheetHeight = webLayout.isMedium
    ? Math.min(680, Math.max(360, Math.round(effectiveHeight * 0.82)))
    : Math.max(
        Platform.OS === 'web' ? 180 : 320,
        Math.round((effectiveHeight - insets.top) * 0.92),
      );
  const targetHeightRef = useRef(targetSheetHeight);
  targetHeightRef.current = targetSheetHeight;

  const translateY = useSharedValue(reduceMotion ? 0 : targetSheetHeight);
  const backdropProgress = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    if (reduceMotion) {
      translateY.value = 0;
      backdropProgress.value = 1;
      return;
    }
    translateY.value = withSpring(0, motion.spring.spatialDefault);
    backdropProgress.value = withSpring(1, motion.spring.effectsDefault);
  }, [backdropProgress, reduceMotion, translateY]);

  const finishClose = useCallback(() => {
    closeRef.current();
  }, []);

  const requestClose = useCallback(
    (immediate = false) => {
      if (closingRef.current) return;
      closingRef.current = true;
      Keyboard.dismiss();
      if (immediate || reduceMotion) {
        finishClose();
        return;
      }
      cancelAnimation(translateY);
      cancelAnimation(backdropProgress);
      backdropProgress.value = withTiming(0, motion.exit);
      translateY.value = withTiming(targetHeightRef.current, motion.exit, () => {
        runOnJS(finishClose)();
      });
    },
    [backdropProgress, finishClose, reduceMotion, translateY],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => sub.remove();
  }, [requestClose]);
  useEscapeKey(true, () => requestClose());

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKeyboardHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleOverlayLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > maxOverlayHeightRef.current) {
      maxOverlayHeightRef.current = h;
    }
    setOverlayHeight((prev) => (Math.abs(prev - h) > 1 ? h : prev));
  }, []);

  const windowShrank = maxOverlayHeightRef.current - overlayHeight > androidKeyboardHeight * 0.5;
  const extraKeyboardInset =
    Platform.OS === 'android' && androidKeyboardHeight > 0 && !windowShrank
      ? androidKeyboardHeight
      : 0;

  const dismissPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!webLayout.isMedium)
        .activeOffsetY(8)
        .failOffsetX([-20, 20])
        .onUpdate((e) => {
          'worklet';
          if (e.translationY >= 0) {
            translateY.value = e.translationY;
          } else {
            translateY.value = -Math.min(MAX_RUBBER_UP, Math.sqrt(-e.translationY) * 2.2);
          }
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationY > 96 || e.velocityY > 760) {
            if (reduceMotion) {
              runOnJS(requestClose)(true);
              return;
            }
            const remaining = Math.max(0, targetSheetHeight - Math.max(0, translateY.value));
            const speed = Math.max(1200, e.velocityY);
            const duration = Math.max(100, Math.min(180, Math.round((remaining / speed) * 1000)));
            backdropProgress.value = withTiming(0, { duration, easing: motion.exit.easing });
            translateY.value = withTiming(
              targetSheetHeight,
              { duration, easing: motion.exit.easing },
              (finished) => {
                if (finished) runOnJS(requestClose)(true);
              },
            );
          } else {
            translateY.value = withSpring(0, {
              ...motion.spring.spatialDefault,
              velocity: e.velocityY,
            });
          }
        }),
    [backdropProgress, reduceMotion, requestClose, targetSheetHeight, translateY, webLayout.isMedium],
  );

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => {
    const dragFactor =
      1 - Math.min(1, Math.max(0, translateY.value) / Math.max(1, targetSheetHeight * 0.72));
    return { opacity: backdropProgress.value * dragFactor * 0.58 };
  });

  const entries = useMemo(() => getCityEntries(s), [s]);

  const filteredCities = useMemo(
    () => filterCityEntries(entries, query, [selectedCityId]),
    [entries, query, selectedCityId],
  );

  const handleCityPress = useCallback(
    (city: CityDef) => {
      if (switchingRef.current) return;
      if (city.id === selectedRef.current) {
        requestClose();
        return;
      }
      selectRef.current(city.id);
      requestClose();
    },
    [requestClose],
  );

  const renderItem = useCallback(
    ({ item }: { item: CityEntry }) => (
      <CityRow
        entry={item}
        active={item.city.id === selectedCityId}
        switching={Boolean(switchingCity) && switchingCityId === item.city.id}
        disabled={Boolean(switchingCity)}
        onPress={handleCityPress}
      />
    ),
    [handleCityPress, selectedCityId, switchingCity, switchingCityId],
  );

  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: 24 + insets.bottom }],
    [insets.bottom],
  );

  const emptyComponent = useMemo(
    () => (
      <View style={styles.emptyContainer}>
        <MapPinOff size={28} color={scheme.onSurfaceVariant} />
        <Text style={styles.emptyTitle}>{s.city.noSearchResults(query.trim())}</Text>
        <Text style={styles.emptySub}>{s.city.searchEmptyHint}</Text>
      </View>
    ),
    [query, s],
  );

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        { paddingTop: insets.top, paddingBottom: extraKeyboardInset },
      ]}
      onLayout={handleOverlayLayout}
      accessibilityViewIsModal
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropAnimatedStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => requestClose()}
          accessibilityRole="button"
          accessibilityLabel={s.city.closeSheetA11y}
        />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.kav, webLayout.isMedium && styles.kavDesktop]}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.sheet,
            webLayout.isMedium && styles.sheetDesktop,
            webLayout.isMedium && elev.level3,
            { height: targetSheetHeight },
            sheetAnimatedStyle,
          ]}
        >
          <View style={[styles.container, webLayout.isMedium && styles.containerDesktop]}>
            <GestureDetector gesture={dismissPanGesture}>
              <View collapsable={false}>
                {!webLayout.isMedium && (
                  <View style={styles.handleRow}>
                    <View style={styles.handle} />
                  </View>
                )}
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <Text style={styles.title} accessibilityRole="header">
                      {s.city.selectTitle}
                    </Text>
                    <Text style={styles.subtitle}>{s.city.selectSub}</Text>
                  </View>
                </View>
              </View>
            </GestureDetector>

            <SpringPressable
              onPress={() => requestClose()}
              hitSlop={8}
              scaleDelta={0.06}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel={s.city.closeSheetA11y}
            >
              <X size={20} color={scheme.onSurfaceVariant} />
            </SpringPressable>

            <View style={styles.searchBox}>
              <Search size={18} color={scheme.onSurfaceVariant} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={s.city.searchPlaceholder}
                accessibilityLabel={s.city.searchPlaceholder}
                placeholderTextColor={scheme.onSurfaceVariant}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="never"
                onSubmitEditing={() => {
                  if (filteredCities.length > 0) {
                    handleCityPress(filteredCities[0].city);
                  }
                }}
              />
              {query.length > 0 ? (
                <SpringPressable
                  onPress={() => setQuery('')}
                  hitSlop={8}
                  scaleDelta={0.06}
                  haptic="selection"
                  style={styles.searchClearBtn}
                  accessibilityRole="button"
                  accessibilityLabel={s.city.searchClearA11y}
                >
                  <X size={16} color={scheme.onSurfaceVariant} />
                </SpringPressable>
              ) : null}
            </View>

            <FlatList
              data={filteredCities}
              keyExtractor={keyExtractor}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              overScrollMode="never"
              showsVerticalScrollIndicator
              removeClippedSubviews={Platform.OS === 'android'}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              updateCellsBatchingPeriod={16}
              windowSize={9}
              style={styles.list}
              contentContainerStyle={listContentStyle}
              renderItem={renderItem}
              ListEmptyComponent={emptyComponent}
            />
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 100,
    elevation: 24,
  },
  backdrop: {
    backgroundColor: '#000000',
  },
  kav: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  kavDesktop: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  sheet: {
    maxHeight: '100%',
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    backgroundColor: scheme.surfaceContainerLow,
    overflow: 'hidden',
  },
  sheetDesktop: {
    width: '100%',
    maxWidth: 560,
    borderRadius: shape.extraLarge,
    borderWidth: 1,
    borderColor: scheme.outlineVariant,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  containerDesktop: {
    paddingTop: 18,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 14,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: scheme.outlineVariant,
  },
  header: {
    paddingRight: 56,
    marginBottom: 20,
  },
  headerText: {
    minWidth: 0,
  },
  title: {
    ...type.titleLarge,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  subtitle: {
    ...type.bodyMedium,
    color: scheme.onSurfaceVariant,
    lineHeight: 21,
    marginTop: 6,
  },
  closeBtn: {
    position: 'absolute',
    top: 22,
    right: 20,
    width: 48,
    height: 48,
    borderRadius: shape.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerHigh,
    borderRadius: shape.large,
    paddingLeft: 16,
    paddingRight: 4,
    minHeight: 56,
    gap: 10,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    ...type.bodyLarge,
    color: scheme.onSurface,
    paddingVertical: 14,
  },
  searchClearBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 4,
  },
  cityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: scheme.surfaceContainerLow,
    borderRadius: shape.large,
    paddingHorizontal: 18,
    paddingVertical: 18,
    minHeight: 84,
    gap: 12,
  },
  cityItemActive: {
    backgroundColor: scheme.primaryContainer,
  },
  cityItemDisabled: {
    opacity: 0.5,
  },
  cityItemPressed: {
    backgroundColor: scheme.surfaceContainerHigh,
    transform: [{ scale: 0.992 }],
  },
  cityItemContent: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  cityName: {
    ...type.titleMedium,
    color: scheme.onSurface,
    fontWeight: '500',
  },
  cityNameActive: {
    color: scheme.onPrimaryContainer,
  },
  radioOutline: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: scheme.outline,
  },
  cityFeeds: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    lineHeight: 19,
  },
  cityFeedsActive: {
    color: scheme.onPrimaryContainer,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    gap: 8,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    ...type.titleSmall,
    color: scheme.onSurface,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySub: {
    ...type.bodySmall,
    color: scheme.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 18,
  },
});
