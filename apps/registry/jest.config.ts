/* eslint-disable */
export default {
  displayName: 'registry',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  coverageDirectory: '../../coverage/apps/registry',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // The approval-policy module uses runtime values from @helix/approvals (the policy
  // validator), so map the workspace import to source (tsconfig paths aren't read by jest).
  moduleNameMapper: {
    '^@helix/approvals$': '<rootDir>/../../libs/approvals/src/index.ts',
  },
  // testcontainers spin-up can take time on first run
  testTimeout: 60_000,
};
