// Bazowa bramka lint: łapie błędy, nie styl. no-explicit-any wyłączone celowo:
// kod powszechnie używa any (LocalGtfsStore), dokręcanie to osobny refactor.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'docs/',
      '**/dist/',
      '**/build/',
      '.expo/',
      'android/',
      'ios/',
      // Vendored skille (1:1 z upstream), nie nasz kod.
      '.agents/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,cjs}'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.node,
    },
  },
  // Skrypty są celowo commonjs (app.config, pluginy Expo, skrypty tsx).
  {
    files: ['**/*.js', '**/*.cjs', 'server/scripts/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // no-unused-vars to twarda bramka: martwy kod blokuje PR zamiast migać
      // w logu. Parametry/zmienne z podkreśleniem zostają (świadomie ignorowane,
      // np. parametr miasta trzymany dla parzystości API). Reszta reguł łapie
      // wyłącznie istniejący kod (puste catch, cause przy rethrow), więc bazowo
      // wyłączona.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off',
      'no-unused-vars': 'off',
    },
  },
);
