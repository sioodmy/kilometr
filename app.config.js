// Dynamiczna konfiguracja Expo: wersja w metadanych APK musi zgadzać się
// z tagiem GitHub Release. CI przekazuje tag kanału przez APP_VERSION
// (prod: vX.Y.Z, nightly: nightly-YYYYMMDD-HHMM-<sha>). Lokalnie bez tej
// zmiennej zostaje wersja z app.json.
const appJson = require('./app.json');

function staticExpo(config) {
  if (config) return config.expo || config;
  return appJson.expo || appJson;
}

// versionCode musi być liczbą całkowitą i rosnąć wraz z wydaniami.
// prod: vX.Y.Z -> X*1000000 + Y*1000 + Z.
// nightly: nightly-YYYYMMDD-HHMM-* -> minuty od 2020-01-01.
// Fallback (dev): 1.
function versionCodeFromVersion(version) {
  const semver = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (semver) {
    return Number(semver[1]) * 1000000 + Number(semver[2]) * 1000 + Number(semver[3]);
  }

  const nightly = /^nightly-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(version);
  if (nightly) {
    const year = Number(nightly[1]);
    const month = Number(nightly[2]);
    const day = Number(nightly[3]);
    const hour = Number(nightly[4]);
    const minute = Number(nightly[5]);
    const daysSinceEpoch = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
    return (daysSinceEpoch - 18262) * 1440 + hour * 60 + minute;
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
