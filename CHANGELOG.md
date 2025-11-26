# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.13] - 2025-11-26

### Fixed

- Fixed EventProcessor to merge attachments and metadata from multiple graph nodes instead of replacing them, preventing data loss when multiple nodes produce outputs

## [0.1.12] - 2025-11-25

### Added

- Added `text` field to EventProcessor final result for backwards compatibility with clients expecting plain text response
- Added explicit `@Inject(BuilderRegistryService)` decorator in GraphController for proper NestJS dependency injection

### Changed

- EventProcessor now extracts text from "text" channel and concatenates all text steps into a single string
- Enhanced logging in EventProcessor to include textLength metric

## [0.1.9] - 2025-11-12

### Added

- Implemented manual JSON Schema to Zod conversion for better type safety in MCP tools
- Added parameter descriptions to tool descriptions as workaround for zodToJsonSchema limitations
- Added detailed logging for schema conversions and tool execution lifecycle (start, end, error)
- Added `zod-from-json-schema` dependency for improved schema conversion

### Changed

- Removed string truncation in trace sanitization to preserve full tool inputs/outputs
- Refactored MCP converter with enhanced schema handling and better error messages

### Removed

- Removed separate metrics webhook - backend now extracts metrics from trace events
- Removed metrics calculation from EventProcessor (moved to backend)

## [0.1.8] - 2025-11-11

### Changed

- Refactored dependency injection system in UniversalGraphModule
- Added explicit factory providers for EventProcessor and LangGraphEngine
- Made ConfigService optional in LangGraphEngine with proper null safety checks
- Simplified GRAPH_ENGINE provider to directly use LangGraphEngine instance

### Fixed

- Fixed potential undefined dependency injection issues in NestJS module
- Added validation logging for dependency injection to catch initialization errors early
- Improved error handling for missing EventProcessor and ConfigService dependencies

### Code Quality

- Removed debug logging from AbstractGraphBuilder
- Applied consistent code formatting with Prettier
- Enhanced module initialization robustness

## [0.1.6] - 2025-11-05

### Added

- Added `class-transformer` and `class-validator` dependencies for enhanced data validation and transformation support

### Changed

- Refactored imports in `universal-graph.module.ts` for improved code organization and readability
- Updated service discovery paths from `.amelie` to `.flutch` for consistent branding
- Organized module imports to follow consistent grouping pattern

### Infrastructure

- Updated dependencies: class-transformer@^0.5.1, class-validator@^0.14.2

## [0.1.5] - 2025-11-02

### Changed

- **BREAKING**: Migrated build system from TypeScript compiler to tsup for dual package support (ESM + CJS)
- Updated package exports to support both `import` (ESM) and `require` (CommonJS)
- Improved build performance with tsup bundler
- Enhanced module resolution for better compatibility with different bundlers

### Fixed

- Dual package hazard mitigation through proper package.json exports configuration
- Type definitions now correctly generated for both ESM (.d.ts) and CJS (.d.cts) formats

### Infrastructure

- Added tsup as build tool replacing direct TypeScript compilation
- Configured proper dual package exports in package.json
- Updated build output to dist/ with separate ESM and CJS bundles

## [0.1.4] - 2025-10-31

### Added

- GitHub Actions CI/CD pipeline for automated PR checks
- Jest testing framework with TypeScript support (ts-jest)
- Prettier code formatter configuration
- Automated tests for callback system (7 test cases covering guards, patches, and retry mechanics)
- Test coverage for CallbackTokenGuard, SmartCallbackRouter, and CallbackStore
- PR workflow checks: code formatting, tests, and build verification

### Changed

- Migrated to Yarn Modern 4.5.3 with Corepack support
- Updated package.json with test and format scripts
- Enhanced CI workflow to run on Node.js 20

### Developer Experience

- Added `yarn test` command for running Jest tests
- Added `yarn format` and `yarn format:check` for code formatting
- Configured automatic code quality checks on pull requests

## [0.1.3] - 2025-10-31

### Added

- Initial release extracted from monorepo
- Core UniversalGraphModule for NestJS integration
- AbstractGraphBuilder base class for graph implementations
- LangGraph.js execution engine integration
- REST API controllers (GraphController, CallbackController)
- Comprehensive callback system with ACL, idempotency, and rate limiting
- Multi-platform callback handlers (Web, Telegram)
- Graph versioning and type utilities (GraphTypeUtils)
- Event streaming and processing infrastructure
- Model initialization for multiple LLM providers (OpenAI, Anthropic, Azure, Mistral, Cohere)
- Redis integration for callback storage
- Prometheus metrics support
- Health check endpoints
- TypeScript type definitions and interfaces
- JSON Schema validation for graph manifests
- MCP (Model Context Protocol) tools support
- Retriever service with MongoDB/PostgreSQL support

### Infrastructure

- Complete TypeScript compilation setup
- NestJS module system integration
- Dependency injection support
- Environment-based configuration

### Documentation

- Comprehensive README with usage examples
- API documentation with TypeScript definitions
- Architecture overview
- Quick start guide

[Unreleased]: https://github.com/flutchai/node-sdk/compare/v0.1.13...HEAD
[0.1.13]: https://github.com/flutchai/node-sdk/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/flutchai/node-sdk/compare/v0.1.9...v0.1.12
[0.1.9]: https://github.com/flutchai/node-sdk/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/flutchai/node-sdk/compare/v0.1.6...v0.1.8
[0.1.6]: https://github.com/flutchai/node-sdk/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/flutchai/node-sdk/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/flutchai/node-sdk/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/flutchai/node-sdk/releases/tag/v0.1.3
