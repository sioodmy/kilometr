import { useCallback, useEffect, useMemo } from 'react';
import { Easing, Platform } from 'react-native';
import { useNavigation } from 'expo-router';
import JSStack, { type StackNavigationOptions } from 'expo-router/js-stack';
import { useReducedMotion } from 'react-native-reanimated';
import { scheme } from '../../src/theme/tokens';
import { useWebLayout } from '../../src/theme/layout';
import { RouteCardTransitionProvider } from '../../src/components/RouteCardTransition';

/** Stos ekranów wyników i szczegółów trasy z kontenerowym morphem karty i płynnym gestem wstecz. */
export default function RoutesLayout() {
  const reduceMotion = useReducedMotion();
  const webLayout = useWebLayout();
  const disableScreenAnim = reduceMotion || webLayout.isMedium;
  const parentNavigation = useNavigation();

  const screenOptions = useMemo<StackNavigationOptions>(
    () => ({
      headerShown: false,
      cardStyle: { backgroundColor: scheme.surface },
      cardShadowEnabled: false,
      gestureEnabled: false,
      animation: disableScreenAnim ? 'none' : 'fade_from_bottom',
    }),
    [disableScreenAnim],
  );

  const indexOptions = useMemo<StackNavigationOptions>(
    () => ({
      freezeOnBlur: false,
    }),
    [],
  );

  const syncParentGesture = useCallback(
    (nestedIndex: number) => {
      if (Platform.OS !== 'ios') return;
      // Gdy otwarte są szczegóły, blokujemy gest rodzica, aby swipe nie uciekał od razu na ekran główny.
      parentNavigation.setOptions({
        gestureEnabled: !webLayout.isMedium && nestedIndex === 0,
      });
    },
    [parentNavigation, webLayout.isMedium],
  );

  useEffect(() => {
    return () => {
      if (Platform.OS === 'ios') {
        parentNavigation.setOptions({ gestureEnabled: !webLayout.isMedium });
      }
    };
  }, [parentNavigation, webLayout.isMedium]);

  const detailOptions = useCallback(
    ({
      route,
      navigation,
    }: {
      route: { params?: Readonly<Record<string, unknown>> };
      navigation: { getState: () => { index: number } };
    }): StackNavigationOptions => {
      const hasCardMorph = route.params?.morph === '1' && !disableScreenAnim;
      if (hasCardMorph) {
        return {
          presentation: 'transparentModal',
          detachPreviousScreen: false,
          cardStyle: { backgroundColor: 'transparent' },
          cardOverlayEnabled: false,
          cardShadowEnabled: false,
          animation: 'none',
          gestureEnabled: false,
        };
      }
      const hasListBehind = navigation.getState().index > 0;
      return {
        presentation: 'card',
        cardStyle: { backgroundColor: scheme.surface },
        animation: disableScreenAnim ? 'none' : 'fade_from_bottom',
        ...(disableScreenAnim
          ? {}
          : {
              transitionSpec: {
                open: {
                  animation: 'timing' as const,
                  config: {
                    duration: 200,
                    easing: Easing.bezier(0.05, 0.7, 0.1, 1),
                  },
                },
                close: {
                  animation: 'timing' as const,
                  config: {
                    duration: 150,
                    easing: Easing.bezier(0.3, 0, 0.8, 0.15),
                  },
                },
              },
            }),
        gestureEnabled: Platform.OS === 'ios' && !webLayout.isMedium && hasListBehind,
        gestureDirection: 'horizontal',
      };
    },
    [disableScreenAnim, webLayout.isMedium],
  );

  return (
    <RouteCardTransitionProvider>
      <JSStack
        screenOptions={screenOptions}
        screenListeners={{
          state: (event) => {
            const nextIndex =
              (event.data as { state?: { index?: number } } | undefined)?.state?.index ?? 0;
            syncParentGesture(nextIndex);
          },
        }}
      >
        <JSStack.Screen name="index" options={indexOptions} />
        <JSStack.Screen name="[id]" options={detailOptions} />
      </JSStack>
    </RouteCardTransitionProvider>
  );
}
