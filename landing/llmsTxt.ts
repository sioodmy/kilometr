import { COVERAGE_CITIES } from './src/coverageData';
import { COFFEE_URL, GITHUB_URL, IPA_URL, PLAY_STORE_URL } from './src/data';

const SITE_URL = 'https://kilometr.app';
const WEB_APP_URL = 'https://web.kilometr.app';

export function buildLlmsTxt(): string {
  const cityCount = COVERAGE_CITIES.length;
  const topCities = [...COVERAGE_CITIES]
    .sort((a, b) => b.populationK - a.populationK)
    .slice(0, 10)
    .map((city) => city.name)
    .join(', ');

  return [
    '# Kilometr',
    '',
    `> Open-source public transit and rail trip planner for Poland, supporting offline GTFS schedules, live vehicle positions, and route planning across ${cityCount} cities. Free, without ads or accounts (GPL-3.0).`,
    '',
    'Kilometr combines urban transit (buses, trams, trolleybuses, metro, cable cars) and rail in a single search. Routing and saved places work offline on the device using downloaded GTFS schedules.',
    '',
    '## Pages and App',
    '',
    `- [Landing Page](${SITE_URL}/): Overview, supported cities map, screenshots, and download links.`,
    `- [Web PWA](${WEB_APP_URL}/): Browser version of the Kilometr trip planner.`,
    `- [iOS Installation Guide](${SITE_URL}/#ios): Instructions for sideloading the unsigned IPA via Sideloadly.`,
    `- [Privacy Policy](${SITE_URL}/#polityka): Local data storage, optional location usage, and external service requests.`,
    '',
    '## Downloads and Source',
    '',
    `- [GitHub Repository](${GITHUB_URL}): Source code, issue tracker, and releases (GPL-3.0).`,
    `- [Google Play](${PLAY_STORE_URL}): Official Android release.`,
    `- [iOS IPA (Latest Release)](${IPA_URL}): Unsigned IPA package for iOS 16.4+.`,
    `- [Obtainium Config](${SITE_URL}/obtainium.json): Direct APK update configuration for Obtainium on Android.`,
    '',
    '## Coverage',
    '',
    `Kilometr covers ${cityCount} cities and metropolitan areas in Poland, including ${topCities}, as well as regional and intercity rail connections.`,
    '',
    '## Optional',
    '',
    `- [Sitemap](${SITE_URL}/sitemap.xml): XML sitemap for the landing site.`,
    `- [BuyCoffee](${COFFEE_URL}): Voluntary project support.`,
    '',
  ].join('\n');
}
