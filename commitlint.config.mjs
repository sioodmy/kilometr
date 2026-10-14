// Conventional commits po polsku: typ i zakres jak zwykle, temat małą literą
// (np. "sekcja wsparcia..."), więc subject-case wyłączone. Merge commity
// pomijane, bo nie niosą konwencji.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0, 'never'],
  },
  ignores: [(message) => message.startsWith('Merge ')],
};
