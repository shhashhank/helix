/* eslint-disable */
export default {
  displayName: 'analytics',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  coverageDirectory: '../../coverage/libs/analytics',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
