const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite na webie ładuje wa-sqlite.wasm jako zasób statyczny.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

// Expo domyślnie wyłącza inlineRequires. Włączamy, żeby moduły używane
// dopiero po pierwszej klatce nie były wykonywane na starcie.
const baseGetTransformOptions = config.transformer.getTransformOptions;
config.transformer.getTransformOptions = async (...args) => {
  const options = (await baseGetTransformOptions(...args)) ?? {};
  return {
    ...options,
    transform: {
      ...(options.transform ?? {}),
      experimentalImportSupport: true,
      inlineRequires: true,
    },
  };
};

module.exports = config;
