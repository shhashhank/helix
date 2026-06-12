/* eslint-disable */
export default {
  displayName: 'telemetry',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  coverageDirectory: '../../coverage/libs/telemetry',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
