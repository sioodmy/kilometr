import obtainiumConfig from '../public/obtainium.json';

export const GITHUB_URL = 'https://github.com/sioodmy/kilometr';
export const GOOGLE_GROUP_URL = 'https://groups.google.com/g/kilometr';
export const BETA_URL = 'https://play.google.com/apps/testing/app.kilometr';
export const IPA_URL = `${GITHUB_URL}/releases/latest/download/kilometr-unsigned.ipa`;
export const SIDELOADLY_URL = 'https://sideloadly.io/';
export const KOFI_URL = 'https://ko-fi.com/sioodmy';
export const OBTAINIUM_URL = `https://apps.obtainium.imranr.dev/redirect?r=${encodeURIComponent(
  `obtainium://app/${encodeURIComponent(JSON.stringify(obtainiumConfig))}`,
)}`;
