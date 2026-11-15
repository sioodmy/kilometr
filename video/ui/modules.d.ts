// Typy dla modułów, których aplikacja nie używa poza zrzutami ekranów w wideo.

// react-native-web ma to samo API co react-native, a własnych typów nie ma.
declare module 'react-native-web' {
  export * from 'react-native';
}

declare module 'react-dom' {
  export const version: string;
}
