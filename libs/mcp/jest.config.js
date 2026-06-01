/* eslint-disable */
const { dirname } = require('path');

// Load the SDK's CJS build in jest (the package is ESM-first). ts-jest transpiles
// our sources to CommonJS (so dynamic import() downlevels to require()), and this
// mapper routes the SDK specifiers to its dist/cjs files.
const sdkCjs = dirname(dirname(require.resolve('@modelcontextprotocol/sdk/client')));

module.exports = {
  displayName: 'mcp',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: { '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }] },
  moduleFileExtensions: ['ts', 'js', 'html', 'json'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleNameMapper: {
    '^@modelcontextprotocol/sdk/(.*)$': `${sdkCjs}/$1`,
  },
};
