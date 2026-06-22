/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.test.json" }],
  },
  testMatch: [
    "<rootDir>/src/**/__tests__/**/*.test.ts",
    "<rootDir>/src/apiKeyAuth.test.ts",
    "<rootDir>/src/indexerWebhook.test.ts",
    "<rootDir>/src/validation/**/*.test.ts",
  ],
  collectCoverageFrom: [
    "src/cache/**/*.ts",
    "src/services/**/*.ts",
    "src/validation/**/*.ts",
  ],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};