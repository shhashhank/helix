/* eslint-disable */
export default {
  displayName: 'testing-agent',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  moduleNameMapper: {
    '^@helix/sandbox$': '<rootDir>/../sandbox/src/index.ts',
    '^@helix/llm$': '<rootDir>/../llm/src/index.ts',
  },
  coverageDirectory: '../../coverage/libs/testing-agent',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
