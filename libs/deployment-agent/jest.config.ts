/* eslint-disable */
export default {
  displayName: 'deployment-agent',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  coverageDirectory: '../../coverage/libs/deployment-agent',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
