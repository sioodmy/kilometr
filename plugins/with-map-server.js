// Config plugin: pozwala WebView mapy łączyć się z lokalnym serwerem kafelków.
//
// Manifest Androida od API 28 blokuje cały ruch „cleartext" (http) domyślnie.
// Serwer mapy nasłuchuje na http://127.0.0.1, więc bez tego wpisu WebView nie
// pobierze ani kafelków, ani silnika mapy, i zostanie tylko mapa online.
//
// Otwieramy cleartext WYŁĄCZNIE dla localhosta. Cały pozostały ruch (rozkłady,
// OSRM, kafle online) dalej wymaga https — nie osłabiamy bezpieczeństwa.
//
// Wymaga builda deweloperskiego; w Expo Go modułu mapy i tak nie ma.

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = 'network_security_config';

function withNetworkSecurityConfig(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    if (!app) return config;
    app.$ = app.$ || {};
    if (!app.$['android:networkSecurityConfig']) {
      app.$['android:networkSecurityConfig'] = `@xml/${CONFIG_FILE}`;
    }
    return config;
  });
}

function withNetworkSecurityFile(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const resDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(resDir, { recursive: true });
      const xml = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<network-security-config>',
        '  <!-- Lokalny serwer kafelkow mapy. Reszta ruchu nadal po https. -->',
        '  <domain-config cleartextTrafficPermitted="true">',
        '    <domain includeSubdomains="false">127.0.0.1</domain>',
        '    <domain includeSubdomains="false">localhost</domain>',
        '  </domain-config>',
        '</network-security-config>',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(resDir, `${CONFIG_FILE}.xml`), xml);
      return config;
    },
  ]);
}

module.exports = function withMapServer(config) {
  config = withNetworkSecurityConfig(config);
  config = withNetworkSecurityFile(config);
  return config;
};