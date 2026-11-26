import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
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
        gestureEnabled: Platform.OS === 'ios' && !webLayout.isMedium && hasListBehind,
        gestureDirection: 'horizontal',
      };
    },
    [disableScreenAnim, webLayout.isMedium],
  );

  return (
    <RouteCardTransitionProvider>
      <JSStack screenOptions={screenOptions}>
        <JSStack.Screen name="index" />
        <JSStack.Screen name="[id]" options={detailOptions} />
      </JSStack>
    </RouteCardTransitionProvider>
  );
}
