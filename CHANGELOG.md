# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.24] - 2026-01-28

### Changed

- **Production-ready tool block matching**: replaced FIFO queue with `run_id`-keyed Map (`toolBlocksByRunId`) for reliable tool output assignment
- `on_tool_start` now links `event.run_id` to the correct pending tool block by name
- `on_tool_end` uses `run_id` lookup with FIFO fallback for backwards compatibility
- `on_tool_error` now drains the matching tool block from the map (fixes queue desync bug)
- Safety net in `getResult`: warns about orphaned tool blocks at finalization

### Added

- 7 new tests for `run_id`-based tool block matching (out-of-order completion, error draining, FIFO fallback, orphaned blocks)

## [0.1.23] - 2026-01-27

### Fixed

- Removed temporary debug logging (`[DELTA]`, `[on_tool_end]`) from EventProcessor

### Added

- **Increased test coverage**: 33 new tests for `EventProcessor` (normalizeContentBlocks, on_chain_end, trace capture, getResult) and `sanitizeTraceData` (primitives, circular refs, depth limits, Set/Map)
- EventProcessor coverage: 71% → 85%, api-call-tracer: 0% → 65%

## [0.1.22] - 2026-01-27

### Fixed

- **Tool block matching in EventProcessor**: Fixed `on_tool_end` assigning output to wrong tool block when multiple tools are streamed sequentially. Added `pendingToolBlocks` FIFO queue to correctly match tool outputs by order of creation instead of relying on `currentBlock`
- Added warning log when `on_tool_end` arrives without a matching pending tool block

### Added

- **EventProcessor unit tests**: 21 test cases covering text streaming, single/multi tool lifecycle, channel routing, JSON serialization, edge cases, and `getResult` finalization
- **CI coverage reporting**: PR checks now run tests with `--coverage` and post a coverage summary comment to the PR

## [0.1.21] - 2026-01-22

### Added

- **Comprehensive Examples**: Added 8 working examples demonstrating all major SDK features:
  - `01-basic-graph` - Minimal graph setup with `AbstractGraphBuilder` and `UniversalGraphModule`
  - `02-chat-agent` - Conversational AI with OpenAI integration and message history
  - `03-rag-agent` - Retrieval-Augmented Generation pipeline with document retrieval
  - `04-tool-calling` - Agent with tool calling using `DynamicStructuredTool` and `ToolNode`
  - `05-callbacks` - Interactive callbacks with `@Callback` and `@WithCallbacks` decorators
  - `06-streaming` - Real-time SSE streaming responses
  - `07-multi-llm` - Multi-provider support (OpenAI, Anthropic, Mistral)
  - `08-mcp-tools` - MCP (Model Context Protocol) tool integration

### Documentation

- Each example includes README with usage instructions, API examples, and key concepts
- Added main `examples/README.md` with overview, learning path, and common patterns
- Added `docker-compose.yml` to all examples for easy Redis setup

## [0.1.20] - 2026-01-22

### Added

- **Goal Tracking Support**: Added `threadId` to tool execution context to enable goal tracking in MCP Runtime
- `IToolExecutionContext` interface now includes optional `threadId` field
- `McpConverter` now extracts `thread_id`, `agentId`, and `userId` from `RunnableConfig.configurable` and passes them as context to MCP Runtime
- Unit tests for context extraction in `McpConverter` (13 new test cases)

### Changed

- `McpConverter.convertTool()` now accepts `RunnableConfig` parameter in the tool function to access graph configurable
- `mcp-tool-filter.ts` updated to support context passing in tool execution

### Related

- Closes flutchai/flutch#548
- Required for goal tracking feature (MCP Runtime PR #547)

## [0.1.19] - 2025-01-14

### Added

- Configurable `recursionLimit` parameter for LangGraph execution to prevent `GraphRecursionError`
- Default recursion limit increased from 25 (LangGraph default) to 40 for complex multi-tool workflows
- `recursionLimit` can be overridden via `config.recursionLimit` in both `invokeGraph()` and `streamGraph()` methods

### Fixed

- Fixed `GraphRecursionError: Recursion limit of 25 reached without hitting a stop condition` that occurred during complex agent workflows with many tool calls

## [0.1.17] - 2025-12-20

### Fixed

- Fixed TypeScript compilation error in mcp-converter.ts by replacing `require()` with ES6 `import` for zod-to-json-schema
- Added zod-to-json-schema as a runtime dependency to package.json
- Fixed tool output correlation in EventProcessor by implementing run_id and tool_call_id mapping system
- Tool outputs now correctly match to their corresponding tool_use blocks even when multiple tools execute concurrently
- Added bidirectional mapping (run_id → block, tool_call_id → block) to handle various tool execution scenarios

### Changed

- Enhanced MCP Runtime HTTP client to pass tool_call_id in metadata for better event correlation
- Improved tool event logging with tool_call_id tracking
- EventProcessor now maintains separate maps for run_id and tool_call_id to tool block associations

## [0.1.16] - 2025-12-09

### Fixed

- **Critical**: Fixed trace data loss when graph execution fails with an error. Now trace events are ALWAYS sent to backend webhook for billing, even when the graph throws an exception. This ensures LLM tokens spent before an error are properly tracked for billing purposes.

### Added

- Comprehensive unit tests for LangGraphEngine (12 test cases)
- Tests cover: streaming, error handling, trace preservation, webhook behavior, abort signals
- Critical test verifying trace is sent for billing even on graph failures

### Changed

- LangGraphEngine.streamGraph() now uses try-catch-finally pattern to ensure trace webhook is called in finally block
- Added `status` and `error` fields to trace webhook payload to indicate execution result
- Improved error logging with stack traces for debugging

## [0.1.14] - 2025-12-06

### Changed

- Increased default timeout for MCP Runtime HTTP client from 30 seconds to 15 minutes (configurable via `MCP_RUNTIME_TIMEOUT` env variable)
- This allows long-running tools like `call_agent` to complete without timing out

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

[Unreleased]: https://github.com/flutchai/node-sdk/compare/v0.1.21...HEAD
[0.1.21]: https://github.com/flutchai/node-sdk/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/flutchai/node-sdk/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/flutchai/node-sdk/compare/v0.1.17...v0.1.19
[0.1.17]: https://github.com/flutchai/node-sdk/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/flutchai/node-sdk/compare/v0.1.14...v0.1.16
[0.1.14]: https://github.com/flutchai/node-sdk/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/flutchai/node-sdk/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/flutchai/node-sdk/compare/v0.1.9...v0.1.12
[0.1.9]: https://github.com/flutchai/node-sdk/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/flutchai/node-sdk/compare/v0.1.6...v0.1.8
[0.1.6]: https://github.com/flutchai/node-sdk/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/flutchai/node-sdk/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/flutchai/node-sdk/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/flutchai/node-sdk/releases/tag/v0.1.3
