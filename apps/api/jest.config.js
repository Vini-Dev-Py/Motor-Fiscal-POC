/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'test/.*\.e2e-spec\.ts$|src/.*\.spec\.ts$',
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
  testEnvironment: 'node',
  testTimeout: 60000,
};
