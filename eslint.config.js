import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ESLint 9 removed .eslintrc support, so this replaces .eslintrc.json.
export default tseslint.config(
  {
    // node_modules is ignored by default; build output is not.
    ignores: ['dist/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  }
);
