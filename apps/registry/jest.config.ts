/* eslint-disable */
export default {
  displayName: 'registry',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  coverageDirectory: '../../coverage/apps/registry',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // testcontainers spin-up can take time on first run
  testTimeout: 60_000,
};
