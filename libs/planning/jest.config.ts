/* eslint-disable */
export default {
  displayName: 'planning',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  moduleNameMapper: {
    '^@helix/llm$': '<rootDir>/../llm/src/index.ts',
  },
  coverageDirectory: '../../coverage/libs/planning',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
