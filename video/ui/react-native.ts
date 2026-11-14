// react-native dla zrzutów: react-native-web plus natywne API, których web nie ma.
import stub from './stub.cjs';

export * from 'react-native-web';
export const TurboModuleRegistry = { get: () => null, getEnforcing: () => stub };
export const codegenNativeComponent = () => stub;
export const requireNativeComponent = () => stub;
