// Conventional commits po polsku: typ i zakres jak zwykle, temat małą literą
// (np. "sekcja wsparcia..."), więc subject-case wyłączone. Długie linie
// w ciele (np. listy plików, URL-e, stack trace'y) dopuszczone.
// Merge commity pomijane, bo nie niosą konwencji.
// Nagłówek 120 znaków: squash-merge dokleja "(#123)" do tematu PR-a.
// Legacy: a10ba820 trafił do dev przed wdrożeniem bramki i zostaje w historii,
// więc pomijamy dokładnie ten temat. Nowych wpisów tu nie dodawaj.
const LEGACY_SUBJECTS = new Set(['Redesign home screen and search sheet in M3 Expressive style']);

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0, 'never'],
    'body-max-line-length': [0, 'never'],
    'footer-max-line-length': [0, 'never'],
    'header-max-length': [2, 'always', 120],
  },
  ignores: [
    (message) => message.startsWith('Merge '),
    (message) => LEGACY_SUBJECTS.has(message.split('\n')[0].trim()),
  ],
};
