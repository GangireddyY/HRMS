// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const unusedVars = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true }];

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'public/**'] },
  {
    files: ['src/**/*.{ts,vue}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, ...pluginVue.configs['flat/recommended']],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'], sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': unusedVars,
      // Stylistic; attribute order is not enforced in this codebase.
      'vue/attributes-order': 'off',
      // Optional props are typed with TS (`prop?: T`), so an explicit default is not required.
      'vue/require-default-prop': 'off',
      // `<template v-for="x in [expr]" :key="row.id">` is used as a local-variable idiom and keys on the outer scope.
      'vue/valid-v-for': 'warn',
    },
  },
  {
    files: ['e2e/**/*.ts', '*.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-unused-vars': unusedVars },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
  prettier,
);
