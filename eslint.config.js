// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/drizzle/**', 'ui/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Standalone Node CLI scripts (scripts/generate-jwt.js) — plain .js, not covered by the
    // TS-aware config above, so `no-undef` needs Node's globals (process/console/etc.) declared
    // explicitly here.
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
