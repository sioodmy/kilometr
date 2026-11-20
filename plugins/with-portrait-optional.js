// Config plugin: zdejmuje z Play wymóg sprzętowy android.hardware.screen.portrait.
//
// `orientation: "portrait"` w app.json ustawia android:screenOrientation="portrait"
// na MainActivity, a AAPT2 dokłada do manifestu <uses-feature required="true">.
// Play blokuje wtedy instalację na urządzeniach bez pionowego ekranu (Desktop,
// Android XR, część tabletów). Aplikacja dalej startuje w pionie, ale wymóg
// sprzętowy jest opcjonalny, więc Play nie ogranicza dystrybucji.
//
// Używane przez app.json: "plugins": ["./plugins/with-portrait-optional"].

const { withAndroidManifest } = require('expo/config-plugins');

const FEATURE = 'android.hardware.screen.portrait';

module.exports = function withPortraitOptional(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const features = manifest['uses-feature'] ?? [];
    const existing = features.find((item) => item.$?.['android:name'] === FEATURE);
    if (existing) {
      existing.$['android:required'] = 'false';
    } else {
      features.push({ $: { 'android:name': FEATURE, 'android:required': 'false' } });
    }
    manifest['uses-feature'] = features;
    return config;
  });
};
