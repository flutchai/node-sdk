# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/flutchai/node-sdk/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/flutchai/node-sdk/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/flutchai/node-sdk/releases/tag/v0.1.3
