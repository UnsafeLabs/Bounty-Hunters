/**
 * Jest configuration for TypeScript.
 * Loads and validates ts-jest dependency, then exports a comprehensive config.
 * @returns {object} Jest configuration
 */
'use strict';

const buildJestConfig = () => {
  try {
    require.resolve('ts-jest');
  } catch (error) {
    console.error(
      'FATAL: ts-jest is not installed. Install it with: npm install --save-dev ts-jest'
    );
    process.exit(1);
  }

  const config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src'],
    testMatch: [
      '**/__tests__/**/*.ts?(x)',
      '**/?(*.)+(spec|test).ts?(x)',
    ],
    transform: {
      '^.+\\.tsx?$': 'ts-jest',
    },
    moduleFileExtensions: [
      'ts',
      'tsx',
      'js',
      'jsx',
      'json',
      'node',
    ],
    collectCoverageFrom: [
      'src/**/*.{ts,tsx}',
      '!src/**/*.d.ts',
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['json', 'lcov', 'text', 'clover'],
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true,
    globals: {
      'ts-jest': {
        tsconfig: 'tsconfig.json',
      },
    },
  };

  console.log('Jest configuration loaded successfully.');
  return config;
};

module.exports = buildJestConfig();