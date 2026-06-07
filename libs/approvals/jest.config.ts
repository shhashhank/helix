/* eslint-disable */
export default {
  displayName: 'approvals',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  coverageDirectory: '../../coverage/libs/approvals',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
