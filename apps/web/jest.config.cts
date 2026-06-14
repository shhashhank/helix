module.exports = {
  displayName: 'web',
  preset: '../../jest.preset.js',
  testEnvironment: 'jsdom', // React components need a DOM
  setupFiles: ['<rootDir>/src/test-setup.ts'], // TextEncoder/TextDecoder polyfill for the SSE reader
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
    '^.+\\.[tj]sx?$': ['babel-jest', { presets: ['@nx/react/babel'] }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/apps/web',
};
