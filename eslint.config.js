import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/.terraform/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The engine must stay free of UI and platform code so it runs in a Web Worker, Node.js and Lambda.
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-*', '@xyflow/*', 'zustand', 'node:*'] },
      ],
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage'],
    },
  },
);
