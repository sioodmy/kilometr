// Config plugin: Contributor tylko poza prod.
//
// Kilometr Contributor (telemetria GPS dla testerów) pyta użytkownika o zgodę
// na lokalizację w tle (Allow all the time). Google Play wymusza deklarację
// Location permissions, gdy tylko android.permission.ACCESS_BACKGROUND_LOCATION
// pojawi się w przesłanym AAB, nawet jeśli build nie zbiera tła. Prod nie ma
// takiej potrzeby: śledzenie podróży żyje w FGS `specialUse` i wystarcza mu
// zgoda „podczas korzystania”.
//
// Dlatego cały Contributor jest osobnym lokalnym modułem
// (modules/kilometr-contributor), a ten plugin wyłącza moduł z autolinkingu
// na buildach prod (APK vX.Y.Z) i play- (AAB do Google). Zamiast zamazywać
// manifes `tools:node="remove"`, build prod w ogóle nie ma tego projektu:
// ani klasy Kotlin, ani serwisu, ani zgód z manifesu modułu. Buildy testowe
// (nightly/dev/test, także artifact-only oraz lokalne `expo run:android`)
// scalają moduł normalnie.
//
// Kanał wynika z APP_VERSION, tego samego wejścia co app.config.js:
//   prod: vX.Y.Z, AAB Play: play-* -> bez Contributora,
//   nightly-*/dev-*/test-* lub brak zmiennej -> z Contributorem.
//
// Wyłączenie to pole `exclude` ekstensji `expoAutolinking` z expo-modules-
// autolinking. Wstawiamy je PRZED `expoAutolinking.useExpoModules()`, bo to
// wywołanie od razu linkuje rozwiązane projekty i późne ustawienie byłoby martwe.

const { withSettingsGradle } = require('@expo/config-plugins');

const MODULE_NAME = 'kilometr-contributor';

/**
 * Build z Contributorem czy bez, na podstawie APP_VERSION (CI zawsze ją
 * podaje; lokalnie brak zmiennej oznacza build deweloperski).
 */
function contributorMode(version) {
  if (!version) return 'included';
  if (version.startsWith('nightly-') || version.startsWith('dev-') || version.startsWith('test-')) {
    return 'included';
  }
  // vX.Y.Z (prod) i play-* (AAB do Google) - modułu być nie może.
  return 'excluded';
}

module.exports = function withContributor(config) {
  if (contributorMode(process.env.APP_VERSION) !== 'excluded') return config;

  return withSettingsGradle(config, (mod) => {
    const anchor = 'expoAutolinking.useExpoModules()';
    const current = mod.modResults;
    if (current.includes(`expoAutolinking.exclude = listOf("${MODULE_NAME}")`)) {
      return mod;
    }
    if (!current.includes(anchor)) {
      throw new Error(
        'Nie wyłączę Contributora: wygenerowany android/settings.gradle nie ma wywołania `expoAutolinking.useExpoModules()`. Szablon prebuildu się zmienił.',
      );
    }
    mod.modResults = current.replace(
      anchor,
      `// Contributor (telemetria) musi istnieć wyłącznie w buildach testowych,\n// więc buildy do Google wyłączają moduł z autolinkingu.\nexpoAutolinking.exclude = listOf("${MODULE_NAME}")\n${anchor}`,
    );
    return mod;
  });
};

module.exports.contributorMode = contributorMode;
module.exports.CONTRIBUTOR_MODULE_NAME = MODULE_NAME;
