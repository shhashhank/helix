/* eslint-disable */
export default {
  displayName: 'agent',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  moduleNameMapper: {
    '^@helix/llm$': '<rootDir>/../llm/src/index.ts',
  },
  coverageDirectory: '../../coverage/libs/agent',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
