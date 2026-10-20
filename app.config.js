// Dynamiczna konfiguracja Expo: wersja w metadanych APK musi zgadzać się
// z tagiem GitHub Release. CI przekazuje tag kanału przez APP_VERSION
// (prod: vX.Y.Z, nightly: nightly-YYYYMMDD-HHMM-<sha>, podgląd z PR-a:
// dev-YYYYMMDD-HHMM-<sha> albo test-YYYYMMDD-HHMM-<sha>, Play: play-<...>).
// Lokalnie bez tej zmiennej zostaje wersja z app.json.
const appJson = require('./app.json');
const { withAppBuildGradle } = require('expo/config-plugins');

// Slot na numer kompilacji/hotfixu z CI (BUILD_NUMBER, np. GITHUB_RUN_ATTEMPT).
// Dwie ostatnie cyfry versionCode prod, więc zakres 1-99; domyślnie 1.
const BUILD_NUMBER = Math.min(Math.max(Number(process.env.BUILD_NUMBER) || 1, 1), 99);

function staticExpo(config) {
  if (config) return config.expo || config;
  return appJson.expo || appJson;
}

/** Minuty od 2020-01-01 00:00 UTC. Wspólna baza dla kanałów czasowych. */
function minutesSince2020(year, month, day, hour, minute) {
  const daysSinceEpoch = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  return (daysSinceEpoch - 18262) * 1440 + hour * 60 + minute;
}

/**
 * Banda podglądów z PR-ów (dev-/test-). Jest wyższa niż nightly (minuty od
 * 2020, dziś ok. 3,5 mln) i niż prod (X*1000000 + Y*10000 + Z*100 + numer
 * kompilacji), więc APK podglądu instaluje się nad wydaniem. Bez tego podglądy
 * miały versionCode 1, a Android blokuje instalację niższego numeru nad
 * zainstalowaną aplikacją i kończy to komunikatem „app not installed”. Po
 * instalacji podglądu powrót na nightly/prod wymaga odinstalowania.
 */
const PREVIEW_VERSION_CODE_BAND = 500000000;

// Banda buildów wgrywanych do Google Play (testowanie wewnętrzne). Wyżej niż
// podglądy (500 mln) i znacznie wyżej niż prod (max ~10 mln), więc versionCode
// z Play nie skoliduje z wersjami instalowanymi z APK poza sklepem.
const PLAY_VERSION_CODE_BAND = 600000000;

// versionCode musi być liczbą całkowitą i rosnąć wraz z wydaniami.
// prod: vX.Y.Z -> X*1000000 + Y*10000 + Z*100 + BUILD_NUMBER (slot kompilacji
//       z CI; 1.0.0 -> 1000001, kolejny build tego samego wydania -> 1000002).
// nightly: nightly-YYYYMMDD-HHMM-* -> minuty od 2020-01-01.
// podglądy: dev-YYYYMMDD-HHMM-*, test-YYYYMMDD-HHMM-* -> banda podglądów + minuty.
// Play: play-YYYYMMDD-HHMM-* -> banda Play + minuty.
// Brak dopasowania (np. wersja z app.json) -> 1.
function versionCodeFromVersion(version) {
  const semver = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (semver) {
    const major = Number(semver[1]);
    const minor = Number(semver[2]);
    const patch = Number(semver[3]);
    return major * 1000000 + minor * 10000 + patch * 100 + BUILD_NUMBER;
  }

  const dated = /^(nightly|dev|test|play)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(version);
  if (dated) {
    const minutes = minutesSince2020(
      Number(dated[2]),
      Number(dated[3]),
      Number(dated[4]),
      Number(dated[5]),
      Number(dated[6]),
    );
    if (dated[1] === 'nightly') return minutes;
    if (dated[1] === 'play') return PLAY_VERSION_CODE_BAND + minutes;
    return PREVIEW_VERSION_CODE_BAND + minutes;
  }

  return 1;
}

// Podpis release kluczem upload z Play Console. CI przekazuje sekrety w env
// (ANDROID_KEYSTORE_*), do wygenerowanego android/app/build.gradle trafia
// wyłącznie ścieżka keystore, a hasła czyta gradle z env w chwili builda.
// Bez env (pipeline APK i buildy lokalne) buildType release zostaje na
// debug.keystore, więc inne buildy zostają bez zmian.
const withAndroidSigning = (config) =>
  withAppBuildGradle(config, (mod) => {
    const keystorePath = process.env.ANDROID_KEYSTORE_PATH;
    const storePassword = process.env.ANDROID_KEYSTORE_PASSWORD;
    const keyAlias = process.env.ANDROID_KEYSTORE_ALIAS;
    if (!keystorePath || !storePassword || !keyAlias) return mod;

    const gradle = mod.modResults.contents;
    // Prebuild ma dokładnie dwa `signingConfig signingConfigs.debug`: pierwszy
    // w buildTypes.debug, drugi w buildTypes.release. Podmieniamy drugi, żeby
    // buildy debugowe dalej używały debug.keystore.
    const sigRef = 'signingConfig signingConfigs.debug';
    // Do pliku wpisujemy wyłącznie ścieżkę (przychodzi z runner.temp, bez
    // znaków specjalnych). Hasła i alias czyta gradle z env w chwili builda:
    // wklejone literalnie hasło ze znakiem $ w groovy to interpolacja i build
    // pada z "Could not get unknown property".
    const releaseConfig = [
      '        release {',
      `            storeFile file(${JSON.stringify(keystorePath)})`,
      '            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")',
      '            keyAlias System.getenv("ANDROID_KEYSTORE_ALIAS")',
      '            keyPassword System.getenv("ANDROID_KEYSTORE_KEY_PASSWORD") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")',
      '        }',
    ].join('\n');
    const gradleWithConfig = gradle.replace(/signingConfigs\s*\{/, (m) => `${m}\n${releaseConfig}`);
    const firstRef = gradleWithConfig.indexOf(sigRef);
    const secondRef = firstRef < 0 ? -1 : gradleWithConfig.indexOf(sigRef, firstRef + sigRef.length);
    if (secondRef < 0) {
      throw new Error('Nie podpiszę builda: wygenerowany android/app/build.gradle nie ma dwóch bloków signingConfig (debug + release) z template prebuildu.');
    }

    mod.modResults.contents =
      gradleWithConfig.slice(0, secondRef) +
      'signingConfig signingConfigs.release' +
      gradleWithConfig.slice(secondRef + sigRef.length);
    return mod;
  });

module.exports = ({ config }) => {
  const expo = staticExpo(config);
  const version = process.env.APP_VERSION || expo.version || '1.0.0';

  return withAndroidSigning({
    ...expo,
    version,
    ios: {
      ...(expo.ios || {}),
      buildNumber: process.env.IOS_BUILD_NUMBER || expo.ios?.buildNumber || '1',
    },
    android: {
      ...(expo.android || {}),
      versionCode: versionCodeFromVersion(version),
    },
  });
};
