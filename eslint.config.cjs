const browserGlobals = {
  AbortController: 'readonly',
  Blob: 'readonly',
  BroadcastChannel: 'readonly',
  Buffer: 'readonly',
  CustomEvent: 'readonly',
  DOMParser: 'readonly',
  FileReader: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  Image: 'readonly',
  ImageData: 'readonly',
  Intl: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  Notification: 'readonly',
  Promise: 'readonly',
  ReadableStream: 'readonly',
  Response: 'readonly',
  TextDecoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  alert: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  navigator: 'readonly',
  requestAnimationFrame: 'readonly',
  requestIdleCallback: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
  sessionStorage: 'readonly',
  window: 'readonly',
}

const noopRule = {
  meta: { type: 'problem' },
  create() {
    return {}
  },
}

module.exports = [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      'react-hooks': {
        rules: {
          'exhaustive-deps': noopRule,
        },
      },
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: browserGlobals,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
]
