module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts", "**/*.test.ts"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.interface.ts",
    "!src/**/index.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html", "json-summary"],
  moduleNameMapper: {
    // Map package imports to source for tests
    "^@flutchai/flutch-sdk$": "<rootDir>/src/index.ts",
  },
  transform: {
    // uuid@14 (pulled in by @langchain/langgraph*) is ESM-only, so it must be
    // transpiled to CJS for Jest — hence the .js transform + ignore exception.
    "^.+\\.[tj]s$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          allowJs: true,
        },
      },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!uuid/)"],
  // Increase timeout for async tests
  testTimeout: 10000,
};
