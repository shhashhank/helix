/* eslint-disable */
export default {
  displayName: 'tenancy',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  coverageDirectory: '../../coverage/libs/tenancy',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
