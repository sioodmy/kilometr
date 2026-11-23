import obtainiumConfig from '../public/obtainium.json';

export const GITHUB_URL = 'https://github.com/sioodmy/kilometr';
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=app.kilometr&hl=pl-PL';
export const IPA_URL = `${GITHUB_URL}/releases/latest/download/kilometr-unsigned.ipa`;
export const SIDELOADLY_URL = 'https://sideloadly.io/';
export const COFFEE_URL = 'https://buycoffee.to/sioodmy';
export const OBTAINIUM_URL = `https://apps.obtainium.imranr.dev/redirect?r=${encodeURIComponent(
  `obtainium://app/${encodeURIComponent(JSON.stringify(obtainiumConfig))}`,
)}`;
