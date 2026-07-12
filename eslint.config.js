// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/drizzle/**'],
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
  {
    // ui/ is a browser (Vite+React) app, not Node — needs browser globals instead, plus React's
    // hooks-rules-of-hooks/exhaustive-deps checks (the one thing worth linting specially for JSX).
    files: ['ui/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // This project's own spec (ARCHITECTURE.md §12) calls for exactly this pattern — "each page
      // fetches via useEffect + shared API module," no data-fetching library, no global state
      // library. This rule (new in eslint-plugin-react-hooks v7, nudging toward React
      // Query/SWR/`use()`) flags the plain useEffect-fetch-then-setState pattern outright, which
      // is the documented requirement here, not a mistake.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
);
