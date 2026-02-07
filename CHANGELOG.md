# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.5] - 2026-02-07

### Fixed

- **Critical**: Fixed memory leak in `attachmentDataStore` — global in-memory Map was never cleaned up, causing unbounded memory growth with large tool results (e.g. 509MB PostgreSQL queries)
- **Critical**: Fixed race condition — `attachmentDataStore` is now scoped by `threadId` to isolate data between concurrent graph executions
- Fixed `null` data fallback in auto-injection: when both in-memory store is empty and graph state has `data: null`, injection is now correctly skipped (was injecting `"null"` string)
- Fixed JSON truncation in `on_tool_end`: tool output is now cut at the last newline boundary (within 80% of limit) instead of mid-token, preventing broken JSON structures
- Fixed `extractAttachments` filter: `IGraphAttachment` objects (internal, with `data`/`summary`/`toolName` fields) no longer leak into `IAttachment[]` (message attachments requiring `type`/`value` fields)
- Fixed `JSON.stringify` crash on very large tool outputs (509MB) in `on_tool_end` handler with try/catch fallback
- Restored string truncation in `sanitizeTraceData` at 100KB limit to prevent `Invalid string length` errors during trace serialization

### Changed

- `attachmentDataStore` refactored from flat `Map<string, any>` to nested `Map<threadId, Map<toolCallId, data>>` for thread isolation
- `storeAttachmentData`, `getAttachmentData`, `clearAttachmentDataStore` now accept optional `threadId` parameter
- `ExecuteToolWithAttachmentsParams` now accepts optional `threadId` for scoping data store
- `LangGraphEngine.streamGraph()` and `invokeGraph()` now call `clearAttachmentDataStore(threadId)` in `finally` blocks
- Auto-cleanup safety net: thread data is automatically deleted after 10 minutes if `clearAttachmentDataStore` is not called

### Added

- 12 new tests in `attachment-data-store.spec.ts` covering thread isolation, cleanup, auto-cleanup timer, and null data fallback
- Integration test `attachment-message-size.spec.ts` simulating full flow: 9000-row PostgreSQL query through EventProcessor, verifying MongoDB 16MB BSON limit compliance

## [0.2.4] - 2026-02-03

### Added

- `executeToolWithAttachments` function for attachment-aware tool execution in LangGraph nodes
- Automatic large result detection: when tool output exceeds threshold, data is stored as attachment and LLM receives only a summary
- Auto-injection of attachment data into subsequent tool calls when data argument is missing
- Configurable parameters: `threshold`, `injectIntoArg`, `sourceAttachmentId` for flexible integration
- `DEFAULT_ATTACHMENT_THRESHOLD` constant (configurable via `ATTACHMENT_THRESHOLD` env variable)
- 19 unit tests for attachment-tool-node covering injection logic, threshold handling, and error cases

### Changed

- `shouldInjectData` logic: now only injects when argument is truly `undefined`, not when it has any falsy value (fixes overwriting user-provided empty strings, 0, false, null)

## [0.2.3] - 2026-02-02

### Changed

- **BREAKING:** Refactored payload preparation flow:
  - Renamed `prepareConfig()` to `preparePayload()` in `AbstractGraphBuilder` to better reflect that it returns full payload structure
  - `customizeConfig()` hook now accepts full `payload` parameter instead of separate `config` and `payload` arguments
  - `customizeConfig()` now returns modified payload instead of just config
  - `LangGraphEngine.invokeGraph()` and `streamGraph()` now expect `preparedPayload` structure with `{ input, config, signal }` fields
- Removed recursion limit handling from SDK (now managed by backend in payload.config)
- Simplified engine methods to use `preparedPayload.config` directly without internal defaults

### Migration

Update your `customizeConfig` implementation:

```typescript
// Before (0.2.2)
protected async customizeConfig(config: any, payload: IGraphRequestPayload): Promise<any> {
  config.configurable.myField = "value";
  return config;
}

// After (0.2.3)
protected async customizeConfig(payload: IGraphRequestPayload): Promise<any> {
  return {
    ...payload,
    config: {
      ...payload.config,
      configurable: {
        ...payload.config.configurable,
        myField: "value",
      },
    },
  };
}
```

## [0.2.2] - 2026-01-30

### Added

- Input deserialization in `LangGraphEngine` - automatically deserializes LangChain serialized objects (with `lc` property) before graph execution
- Input deserialization in `AbstractGraphBuilder.prepareConfig` - deserializes serialized inputs from payload
- `customizeConfig` hook restored in `AbstractGraphBuilder` - allows child classes to customize config before graph execution

### Changed

- Simplified `prepareConfig` method - now merges `payload.config` with deserialized `payload.input`
- `customizeConfig` hook signature changed to accept both `config` and `payload` parameters
- `LangGraphEngine.invokeGraph` and `streamGraph` now deserialize input before passing to graph

### Fixed

- Input deserialization now properly handles LangChain serialized messages in both `AbstractGraphBuilder` and `LangGraphEngine`

## [0.2.1] - 2026-01-30

### Added

- `IGraphLogger` interface — decouples `AbstractGraphBuilder` logger from NestJS `Logger`, allowing any compatible logger implementation

### Changed

- `AbstractGraphBuilder.logger` type changed from NestJS `Logger` to `IGraphLogger` interface
- `AbstractGraphBuilder.manifestPath` type changed from `string` to `string | null`

## [0.2.0] - 2026-01-30

### Changed

- **BREAKING:** Split `AbstractGraphBuilder` into a clean class hierarchy:
  - `AbstractGraphBuilder` is now a pure base class without registry dependencies (manifest, config, version validation only)
  - New `ExternalGraphBuilder` extends `AbstractGraphBuilder` with required `CallbackRegistry` and `EndpointRegistry` injection and auto-registration
- External graph builders (microservices) should now extend `ExternalGraphBuilder` instead of `AbstractGraphBuilder`
- Backend in-process builders extend `AbstractGraphBuilder` directly (no registries needed)
- Added `@Injectable()` decorator to both `AbstractGraphBuilder` and `ExternalGraphBuilder`

### Migration

Replace `extends AbstractGraphBuilder` with `extends ExternalGraphBuilder` in graph builders that use callbacks or endpoints:

```typescript
// Before
import { AbstractGraphBuilder } from "@flutchai/flutch-sdk";
export class MyBuilder extends AbstractGraphBuilder<"1.0.0"> { ... }

// After
import { ExternalGraphBuilder } from "@flutchai/flutch-sdk";
export class MyBuilder extends ExternalGraphBuilder<"1.0.0"> { ... }
```

## [0.1.27] - 2026-01-29

### Added

- `IGraphAttachment` interface for passing large tool results through graph state without polluting LLM context
- `generateAttachmentSummary` helper with auto-detection of tabular vs text data formats
- `createGraphAttachment` factory function to build attachment objects from tool results
- Unit tests for attachment summary generation (11 test cases covering tabular, text, and edge cases)

## [0.1.26] - 2026-01-29

### Added

- **MongoDB checkpointer support**: Added `@langchain/langgraph-checkpoint-mongodb` dependency for persistent state management in LangGraph workflows
- `createStaticMessage` helper function for streaming messages in LangGraph, simplifying static message creation in stream contexts

### Fixed

- **Event processor**: Prevented duplicate text block finalization in `getResult` method, ensuring clean output without repeated content blocks

## [0.1.25] - 2026-01-28

### Changed

- Extract pure business logic from `CallbackStore`, `ModelInitializer`, and `AbstractGraphBuilder` into dedicated `.logic.ts` files
- Services now delegate to pure functions, reducing coupling and improving testability

### Added

- `callback-store.logic.ts` — 7 pure functions (token generation, record lifecycle)
- `model.logic.ts` — 4 pure functions (reasoning model detection, cache key, config building)
- `graph.logic.ts` — 4 pure functions (graph type, semver validation, callback token parsing)
- Mock-free unit tests for all logic files

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

[Unreleased]: https://github.com/flutchai/node-sdk/compare/v0.2.5...HEAD
[0.2.5]: https://github.com/flutchai/node-sdk/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/flutchai/node-sdk/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/flutchai/node-sdk/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/flutchai/node-sdk/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/flutchai/node-sdk/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/flutchai/node-sdk/compare/v0.1.27...v0.2.0
[0.1.27]: https://github.com/flutchai/node-sdk/compare/v0.1.26...v0.1.27
[0.1.26]: https://github.com/flutchai/node-sdk/compare/v0.1.25...v0.1.26
[0.1.25]: https://github.com/flutchai/node-sdk/compare/v0.1.24...v0.1.25
[0.1.24]: https://github.com/flutchai/node-sdk/compare/v0.1.23...v0.1.24
[0.1.23]: https://github.com/flutchai/node-sdk/compare/v0.1.22...v0.1.23
[0.1.22]: https://github.com/flutchai/node-sdk/compare/v0.1.21...v0.1.22
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
