// react-native-safe-area-context dla zrzutów: pasek stanu rysuje wideo, więc wcięcia są zerowe.
import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

const insets = { top: 0, bottom: 0, left: 0, right: 0 };

export const useSafeAreaInsets = () => insets;
export const SafeAreaView = ({ edges: _edges, ...props }: ViewProps & { edges?: string[] }) => <View {...props} />;
export const SafeAreaProvider = ({ children }: { children?: ReactNode }) => <>{children}</>;
