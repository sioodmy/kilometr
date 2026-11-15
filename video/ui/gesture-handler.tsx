// react-native-gesture-handler dla zrzutów: gesty nic nie robią, dzieci rysują się normalnie.
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

const chain: object = new Proxy({}, { get: () => () => chain });

export const Gesture = chain;
export const GestureDetector = ({ children }: { children: ReactNode }) => children;
export const GestureHandlerRootView = View;
export { ScrollView };
