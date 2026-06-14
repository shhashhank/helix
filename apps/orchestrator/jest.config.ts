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
    '^@helix/notifications$': '<rootDir>/../../libs/notifications/src/index.ts',
    '^@helix/audit$': '<rootDir>/../../libs/audit/src/index.ts',
    '^@helix/telemetry$': '<rootDir>/../../libs/telemetry/src/index.ts',
    '^@helix/auth$': '<rootDir>/../../libs/auth/src/index.ts',
    '^@helix/tenancy$': '<rootDir>/../../libs/tenancy/src/index.ts',
    '^@helix/secrets$': '<rootDir>/../../libs/secrets/src/index.ts',
    '^@helix/secrets/aws-kms$': '<rootDir>/../../libs/secrets/src/aws-kms.ts',
    // Subpath into github-mcp's App-auth only (node:crypto), so the live GitHub verifier
    // doesn't drag the MCP SDK into the orchestrator bundle/tests (HELIX-170).
    '^@helix/github-mcp/app-auth$': '<rootDir>/../../libs/github-mcp/src/app-auth.ts',
  },
};
