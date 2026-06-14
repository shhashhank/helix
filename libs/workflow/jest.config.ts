/* eslint-disable */
export default {
  displayName: 'workflow',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  moduleNameMapper: {
    '^@helix/executor$': '<rootDir>/../executor/src/index.ts',
    '^@helix/sandbox$': '<rootDir>/../sandbox/src/index.ts',
    '^@helix/coding-agent$': '<rootDir>/../coding-agent/src/index.ts',
    '^@helix/testing-agent$': '<rootDir>/../testing-agent/src/index.ts',
    '^@helix/agent$': '<rootDir>/../agent/src/index.ts',
    '^@helix/llm$': '<rootDir>/../llm/src/index.ts',
  },
  coverageDirectory: '../../coverage/libs/workflow',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
};
