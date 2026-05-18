import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    // uuid@14 ships ESM-only; compile it through ts-jest's Babel shim
    '^.+\\.js$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  // Allow Jest to transform uuid (ESM-only package) instead of skipping it
  transformIgnorePatterns: ['/node_modules/(?!uuid)'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^posgoose$': '<rootDir>/src/index.ts',
  },
};

export default config;
