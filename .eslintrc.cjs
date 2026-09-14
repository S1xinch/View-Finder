/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: { es2023: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { sourceType: 'module', ecmaVersion: 2023 },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['out', 'dist', 'node_modules', '*.config.*'],
  overrides: [
    {
      // src/core is the platform-agnostic layer: no Electron, no React/DOM, no
      // reaching into main/preload/renderer. This is what keeps a later phone
      // port plausible without rewriting the data/scoring logic.
      files: ['src/core/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              { name: 'electron', message: 'core/ must stay platform-agnostic.' },
              { name: 'react', message: 'core/ must stay platform-agnostic.' },
              { name: 'react-dom', message: 'core/ must stay platform-agnostic.' }
            ],
            patterns: [
              {
                group: ['**/main/**', '**/renderer/**', '**/preload/**'],
                message: 'core/ must not import from main/renderer/preload.'
              }
            ]
          }
        ]
      }
    },
    {
      files: ['src/renderer/**/*.{ts,tsx}'],
      env: { browser: true },
      plugins: ['react-hooks'],
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn'
      }
    }
  ]
}
