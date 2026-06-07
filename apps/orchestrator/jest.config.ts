/* eslint-disable */
export default {
  displayName: 'orchestrator',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  coverageDirectory: '../../coverage/apps/orchestrator',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // This app uses runtime values from @helix/workflow (validator + temporal client
  // helpers), so map the workspace imports to source (tsconfig paths aren't read by jest).
  moduleNameMapper: {
    '^@helix/workflow/temporal-client$': '<rootDir>/../../libs/workflow/src/temporal-client.ts',
    '^@helix/workflow$': '<rootDir>/../../libs/workflow/src/index.ts',
    '^@helix/approvals$': '<rootDir>/../../libs/approvals/src/index.ts',
  },
};
