// Dynamiczna konfiguracja Expo: wersja w metadanych APK musi zgadzać się
// z tagiem GitHub Release. CI przekazuje tag kanału przez APP_VERSION
// (prod: vX.Y.Z, nightly: nightly-YYYYMMDD-HHMM-<sha>, podgląd z PR-a:
// dev-YYYYMMDD-HHMM-<sha> albo test-YYYYMMDD-HHMM-<sha>). Lokalnie bez tej
// zmiennej zostaje wersja z app.json.
const appJson = require('./app.json');

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
 * 2020, dziś ok. 3,5 mln) i niż prod (X*1000000 + Y*1000 + Z), więc APK
 * podglądu instaluje się nad wydaniem. Bez tego podglądy miały versionCode 1,
 * a Android blokuje instalację niższego numeru nad zainstalowaną aplikacją i
 * kończy to komunikatem „app not installed”. Po instalacji podglądu powrót na
 * nightly/prod wymaga odinstalowania.
 */
const PREVIEW_VERSION_CODE_BAND = 500000000;

// versionCode musi być liczbą całkowitą i rosnąć wraz z wydaniami.
// prod: vX.Y.Z -> X*1000000 + Y*1000 + Z.
// nightly: nightly-YYYYMMDD-HHMM-* -> minuty od 2020-01-01.
// podglądy: dev-YYYYMMDD-HHMM-*, test-YYYYMMDD-HHMM-* -> banda podglądów + minuty.
// Brak dopasowania (np. wersja z app.json) -> 1.
function versionCodeFromVersion(version) {
  const semver = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (semver) {
    return Number(semver[1]) * 1000000 + Number(semver[2]) * 1000 + Number(semver[3]);
  }

  const dated = /^(nightly|dev|test)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(version);
  if (dated) {
    const minutes = minutesSince2020(
      Number(dated[2]),
      Number(dated[3]),
      Number(dated[4]),
      Number(dated[5]),
      Number(dated[6]),
    );
    return dated[1] === 'nightly' ? minutes : PREVIEW_VERSION_CODE_BAND + minutes;
  }

  return 1;
}

module.exports = ({ config }) => {
  const expo = staticExpo(config);
  const version = process.env.APP_VERSION || expo.version || '1.0.0';

  return {
    ...expo,
    version,
    android: {
      ...(expo.android || {}),
      versionCode: versionCodeFromVersion(version),
    },
  };
};
