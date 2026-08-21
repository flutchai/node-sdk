# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.6] - 2026-08-20

### Added

- **Bedrock prompt caching, on by default for Claude models.** Nothing in the SDK ever asked Bedrock to cache anything, so every LLM call re-paid full price for a prefix that never changes. Measured on the zetap console assistant (65 tools, `us.anthropic.claude-opus-5`, us-east-2): the tool schemas alone are **24 575 tokens** and the system prompt another **5 040** — **29 710 input tokens re-sent on every call of every turn**, including each step of a multi-tool answer. `ModelInitializer` now binds `cache_control` alongside the tools on the Bedrock branch, which makes `ChatBedrockConverse` emit `cachePoint` blocks after the tool schemas, the system prompt and the last message. Verified live through the same LangChain path:

  | call                 | billable input | cache write | cache read |
  | -------------------- | -------------- | ----------- | ---------- |
  | before               | 29 710         | —           | —          |
  | first call (cold)    | 2              | 29 708      | 0          |
  | every following call | 2              | 0           | 29 708     |

  Cache reads bill at 10% of the input rate and writes at 1.25x, so the break-even is the **second** call inside the TTL window — i.e. within a single multi-step turn. Bedrock chains the cacheable sections `tools` → `system` → `messages`, and the tool block is identical for every tenant on the same agent config, so one entry serves the whole fleet.

- `models/model.logic` — `modelSupportsPromptCache`, `resolvePromptCacheControl`, `PROMPT_CACHE_MIN_VERSIONS`, `PromptCacheTtl`, `PromptCacheControl`. Support is decided from the model identifier by family + version (opus ≥ 4.0, sonnet ≥ 4.0, haiku ≥ 4.5), the same shape as the sampling-parameter thresholds. Anything the SDK does not recognise — legacy `claude-3-5-*` naming, Nova, DeepSeek, Qwen — gets **no** cache points: an unsupported model rejects the block outright, and a missing cache point only costs money.

- **The same caching on the router path.** `ChatAnthropic` gets `cache_control` as a constructor field — the top-level parameter, which puts one breakpoint on the last cacheable block and advances it as the conversation grows. It survives the router (which forwards the Anthropic body untouched) and is accepted by Bedrock's `InvokeModel` schema behind it, verified live: a request through a locally run router reported `cache_read_input_tokens: 29 615`. This matters because Claude 5 traffic is moving back onto the router — direct Bedrock calls never reach `/internal/report-usage`, so they are never billed — and caching must not be lost in the move.

- `promptCache` / `promptCacheTtl` on `ModelByIdConfig` (per call) and `ModelConfigWithToken` (catalog default). `promptCache: true` forces caching on for a model released after this SDK; `false` turns it off. TTL is `5m` (default) or `1h`.

- **Reasoning effort** — `effort` on `ModelByIdConfig`, `defaultEffort` in the catalog, plumbed to Converse as `additionalModelRequestFields.output_config.effort`. Thinking tokens bill as output ($25/MTok on Opus 5), and effort is the knob for them. Indicative measurement on one analytical question (4096 max tokens): `high` (the default) 2 398 output tokens, `xhigh` 1 884, `medium` 1 205, `low` 1 191. **No default changed** — the field is omitted from the request entirely unless configured, so every existing agent keeps today's behaviour and today's cache entries.

### Behaviour notes

- The two providers take cache settings through different doors and must never be handed both: Converse reads a per-call option, the Anthropic client a constructor field.
- Cache points are bound **only where tools are bound** (Bedrock path). A tool-less model keeps its plain `BaseChatModel` type, because callers there rely on `withStructuredOutput` and friends, which a `RunnableBinding` does not expose.
- Non-Bedrock providers are untouched: `cache_control` is a `ChatBedrockConverse` call option and is never attached to OpenAI / Anthropic-direct / Mistral / Cohere models.
- `effort` is part of Bedrock's prompt-cache key. Alternating levels on one agent re-writes the cached prefix on every switch — pick one level per agent rather than routing per turn.
- Both overrides participate in the model instance cache key, so two configs never share one instance.

## [0.6.5] - 2026-08-04

### Fixed

- **Claude Opus 5 died on the second model call of every tool-using conversation.** Opus 5 (and the rest of the adaptive-thinking generation) returns its reasoning **opaquely**: the Converse stream carries a single `reasoningContent` delta holding only a `signature` — no `text`, no `redactedContent`. `@langchain/aws` maps that to `{ type: "reasoning_content", reasoningText: { signature } }` and, when the message is replayed as history, forwards `reasoningText` to Bedrock verbatim (`langchainReasoningBlockToBedrockReasoningBlock`). The Converse **request** schema requires `reasoningContent.reasoningText.text` to be non-null, so Bedrock rejected the whole request:

  ```
  ValidationException: Value at 'messages.4.member.content.1.member.reasoningContent.reasoningText.text'
  failed to satisfy constraint: Member must not be null
  ```

  The first call always succeeded; the continuation after the tool result always failed, so no multi-step (tool-calling) answer could ever complete. Reasoning blocks that Bedrock's request schema cannot represent are now removed from the outgoing history.

### Added

- `models/reasoning-content.logic` — pure, framework-free sanitizing helpers: `isReasoningBlock`, `isSendableReasoningBlock`, `sanitizeMessageReasoning`, `sanitizeReasoningForBedrock`.
- `FlutchChatBedrockConverse` (`models/bedrock-chat-model`) — `ChatBedrockConverse` that runs the sanitizer in `_generate` (the `.invoke()` path) and `_streamResponseChunks` (the `.stream()` / `streamEvents` path), i.e. on every route into `convertToConverseMessages`. `ModelInitializer` now builds this class on the Bedrock branch. Everything else — tool binding, structured output, cache points, callbacks, streaming — is inherited unchanged.

### Why blocks are dropped rather than repaired

Three repair strategies were tried against live Bedrock (`us.anthropic.claude-opus-5`, us-east-2) with a real signature-only block:

| Strategy                                               | Result                                                                                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reasoningContent.redactedContent = <signature bytes>` | **rejected** — ``Invalid `data` in `redacted_thinking` block``. `redactedContent` is a different, service-encrypted payload; a signature is not a substitute and cannot be fabricated. |
| `reasoningText: { text: "", signature }`               | accepted — but it modifies a _signed_ block, which a provider is explicitly free to reject.                                                                                            |
| drop the block                                         | accepted, model answers normally.                                                                                                                                                      |

Dropping is therefore the rule. The single exception is a turn that was cut off mid-thinking, where dropping would leave `content: []` (rejected by Bedrock in its own right) and there are no `tool_calls` to carry the message: there the block is kept in the normalized `{ text: "", signature }` form.

### Behaviour notes

- **Model-agnostic, not gated on a model list.** The rule is defined purely by "would Bedrock's request schema reject this block", so it needs no per-release model table (unlike `modelAcceptsSamplingParams`, whose semantics are unrelated and untouched). A history without malformed reasoning blocks is returned **by reference** — sonnet-4.5 / 4.6, haiku, and every non-thinking model are not merely unchanged, they are not even copied.
- **Nothing else in a message is lost.** `tool_calls`, `tool_call_chunks`, text blocks, `id`, `response_metadata` and `usage_metadata` all survive — that is what keeps the post-tool continuation working. Messages are cloned, never mutated, so LangGraph state and its checkpoints are untouched.
- Only assistant messages are inspected; human and tool messages are passed through untouched.
- Sanitizing is idempotent, and logs at `debug` when it fires.

## [0.6.4] - 2026-08-03

### Fixed

- **Claude Opus 4.7+ / Claude 5 models were unusable.** The SDK always sent `temperature` to the provider, and those models removed sampling parameters from their request surface — Bedrock rejected every call with `ValidationException: The model returned the following errors: \`temperature\` is deprecated for this model.` Sampling parameters (`temperature`, `topP`, `topK`) are now omitted for models that don't accept them, on both the Bedrock branch and the direct provider branches (Anthropic/OpenAI/Cohere/Mistral).
- **`Number(undefined)` → `NaN`.** `defaultTemperature` / `defaultMaxTokens` were coerced with `Number(...)`, so an absent value became `NaN` and was sent downstream. Absence now means "don't pass the parameter" (`toOptionalNumber`), and the key is omitted from the provider constructor rather than set to `undefined`.

### Added

- `modelAcceptsSamplingParams(modelIdentifier)` (exported from `models/model.logic`) — decides sampling-parameter support from the family + version encoded in the model id instead of a hardcoded list of exact strings. Thresholds: `opus` ≥ 4.7, `sonnet` ≥ 5, `haiku` ≥ 5, plus the `fable` / `mythos` families at any version. Matching is provider-agnostic, so first-party (`claude-opus-5`), Bedrock (`us.anthropic.claude-opus-4-7-20260101-v1:0`) and Vertex (`claude-opus-4-7@20260101`) identifiers all resolve; a trailing date snapshot is never mistaken for a minor version (`claude-opus-4-20250514` stays Opus 4.0). Anything unrecognized — non-Anthropic providers, legacy `claude-3-5-sonnet-*` naming, every release below its threshold — keeps sampling parameters exactly as before.
- `resolveSamplingParams(...)` and `toOptionalNumber(...)` helpers in `models/model.logic`.
- `supportsSamplingParams?: boolean` on `ModelConfig`, `ModelByIdConfig` and `ModelConfigWithToken` — config-level escape hatch that always wins over the identifier check (`true` = force the params through, `false` = never send them, absent = auto-detect). It is part of the model instance cache key, so two calls that differ only by this flag don't share an instance. Forward-compatible: when the model catalog grows a real capability field, the config value takes over with no SDK change.

### Behaviour notes

- An explicitly requested `temperature` on a model that rejects it is **ignored with a warning**, not an error — the request keeps working and the model runs at its own default sampling behaviour. A temperature that was merely inherited from a catalog default is dropped silently (debug-level).
- **No regression for existing models**: `claude-sonnet-4-5` / `4-6`, `claude-opus-4-6` and older, `haiku-4-5`, legacy `claude-3-*`, and all non-Anthropic providers receive `temperature` exactly as before, including explicit `temperature: 0`.

## [0.6.0] - 2026-06-10

### Changed

- Dependency upgrade aligning the SDK with the Nest 11 consumer monorepo:
  - Peer ranges widened to accept Nest 11-era packages: `@nestjs/config` `^3 || ^4`, `@nestjs/mongoose` `^10 || ^11`, `@nestjs/terminus` `^10 || ^11`, `@willsoto/nestjs-prometheus` `^5 || ^6`, `prom-client` `^14 || ^15`.
  - **Breaking**: `@nestjs/axios` peer range moved from `^3.0.0` to `^4.0.0` — consumers still on `@nestjs/axios` 3 need to upgrade alongside.
  - LangChain stack bumped to latest minors (`@langchain/core` 1.1.48, `@langchain/langgraph` 1.3.7, checkpoint-mongodb 1.3.3, openai/anthropic/mistralai/aws/cohere refreshed); `axios` 1.17, `class-validator` 0.15, `zod` 3.25 within the same majors.
  - Toolchain: yarn 4.16, `@types/node` 24, `@types/express` 5, prettier 3.8; dev builds and tests verified green (tsup + DTS, jest).
  - `mongodb` 6 / `mongoose` 8 / `zod` 3 / TypeScript 5.9 stay pinned to remain in lockstep with the consuming monorepo.
- Repo reformatted with prettier 3.8 (new `await import(...)` wrapping style); no functional changes.

### Fixed

- Jest could not parse 5 test suites after the upgrade: `@langchain/langgraph*` now pulls in ESM-only `uuid@14`, which crashed CJS test runs with `SyntaxError: Unexpected token 'export'`. `jest.config.cjs` now transpiles `uuid` through ts-jest (`transformIgnorePatterns` exception + `allowJs`), restoring the full suite — 34/34 suites, 552 tests.

### Why

The consumer monorepo moved to Node 24 LTS / Nest 11; without the widened peer ranges, installs there fail peer resolution. Runtime behavior is unchanged — the major-version note on `@nestjs/axios` is the only action item for external consumers.

## [0.5.0] - 2026-05-30

### Added

- `ModelByIdConfig.mcpServers` / `ModelByIdConfig.mcpContext` — optional inline per-tenant streamable-http MCP server configs (BYO). When present they are forwarded to mcp-runtime so their tools are discovered and bound alongside statically-configured tools:
  - **Schema binding**: `bindToolsToModel` → `McpToolFilter.getFilteredTools` sends `mcpServers` (plus `context`) in `POST /tools/schemas`. `mcpServers` is folded into the model cache key, so a model bound with inline tools is never served from a stale cache hit.
  - **Execution**: `executeToolWithAttachments` → `executeToolWithEvents` → `executeTool` include `mcpServers` in `POST /tools/execute`, so the runtime can resolve a tool that is not in its static boot registry.

### Why

Lets a multi-tenant caller attach a customer's own MCP servers to a single agent invocation without baking them into the runtime's boot config. Fully additive: every new parameter is optional, and when absent the cache key and request bodies are byte-for-byte identical to before — existing callers are unaffected.

## [0.4.1] - 2026-05-23

### Changed

- `FlutchContext` shrinks: `companyId` and `accountId` removed. `X-Flutch-Company-Id` and `X-Flutch-Account-Id` are no longer emitted by `flutchFetch` / `flutchHeaders` / `flutchMistralHook` / `wrapCohereFetcher`. Only `X-Flutch-Agent-Id` (plus message / thread / user / node attribution headers) is propagated to the router.

### Why

The router now forwards `agentId` to the backend usage webhook, which resolves agent → company → account itself. Treating account/company as server-owned identifiers eliminates the spoofing surface (a compromised router-to-backend channel can no longer redirect billing) and simplifies the SDK contract. Pairs with router 0.10.1 and backend 3.3.434.

## [0.4.0] - 2026-05-20

### Added

- `FlutchContext.companyId` / `FlutchContext.accountId` — propagate the originating company / account identity to the router for SaaS / trusted-internal callers.
- **Internal (SaaS) mode**: when `FLUTCHROUTER_INTERNAL_TOKEN` env var is set, every router-bound HTTP call automatically carries the `X-Flutch-Internal-Token` header alongside `X-Flutch-Company-Id` / `X-Flutch-Account-Id` from the current ALS context. The router (≥ 0.10.0) trusts these headers as identity and skips the bearer-token validate-token round-trip, fixing the case where a multi-tenant SaaS backend was billing every LLM call against whichever single `flutch_*` token sat in env.
- `isInternalMode()` — convenience accessor for the env-driven mode flag.

### Changed

- `flutchFetch` / `flutchHeaders` / `flutchMistralHook` / `wrapCohereFetcher` now also emit the internal-token header when configured, in addition to the X-Flutch-\* attribution headers.

### Why

Pairs with router 0.10.0's new SaaS auth mode. OSS deployments keep working unchanged because `FLUTCHROUTER_INTERNAL_TOKEN` is not set on the customer side — the Bearer flutch\_\* flow remains the default.

## [0.3.0] - 2026-05-18

### Added

- `models/flutch-context.ts`: новый модуль — `withFlutchContext()` (AsyncLocalStorage-обёртка), `getFlutchContext()`, `flutchFetch` (drop-in fetch с автоматической инжекцией `X-Flutch-Message-Id` / `X-Flutch-Agent-Id` / `X-Flutch-Thread-Id` / `X-Flutch-User-Id` / `X-Flutch-Node` из контекста).
- `engines/langgraph/langgraph-engine.ts`: `invokeGraph` и `streamGraph` теперь автоматически устанавливают `FlutchContext` из `preparedPayload.config.configurable.context` — node-авторы не делают ничего, заголовки уезжают в роутер сами.
- `models/model.initializer.ts`: при наличии `routerURL` пробрасывается `flutchFetch` в `ChatOpenAI` / `ChatAnthropic` / `OpenAIEmbeddings`. Для Cohere — кастомный `fetcher` через `wrapCohereFetcher(cohereDefaultFetcher)` (Cohere SDK не принимает обычный `fetch`, у него своя `Fetcher.Args` сигнатура). Для Mistral — `beforeRequestHooks: [flutchMistralHook]` (Mistral SDK мутирует `Request` через хуки, а не через custom fetch).
- `flutchHeaders()` / `flutchMistralHook` / `wrapCohereFetcher` — публичные хелперы для подключения других LLM-клиентов с нестандартными HTTP-хуками.

### Why

Связано с router 0.9.0 — он парсит токены из ответа и шлёт usage-webhook бэкенду, который атомарно списывает с баланса компании. `X-Flutch-*` заголовки позволяют группировать списания по сообщению/агенту/треду в `balance_audit.metadata`. SDK берёт на себя проброс контекста графа в HTTP-слой (LangChain сам этого не делает — `RunnableConfig.metadata` идёт только в callbacks/LangSmith, не в HTTP body).

## [0.2.21] - 2026-05-18

### Fixed

- **Bedrock / Converse tool calls were invisible in the UI**: `EventProcessor` only opened a `tool_use` block when an `on_chat_model_stream` chunk delivered the tool name and id inside `chunk.content` (Anthropic-native format). `@langchain/aws` streams tool calls through `AIMessageChunk.tool_call_chunks` instead, and the Bedrock Converse wrapper drops `name`/`id` from those chunks entirely — only incremental `args` arrive. As a result `pendingToolBlocks` stayed empty, `on_tool_end` logged `⚠️ no matching tool block`, and the final `contentChains` contained only text. The IN/OUT block disappeared from the chat the moment an agent switched from Anthropic-native to Bedrock.
  - Extended the `on_chat_model_stream` handler to also read `chunk.tool_call_chunks` and convert them to the existing Anthropic-style blocks (covers OpenAI and any other provider that uses the LangChain unified streaming format and actually populates `name`/`id`).
  - Added a fallback in the `on_tool_start` handler: when no pending tool block exists for this tool name, synthesize one inline using `event.name` + `event.data.input` + `event.run_id`. This is the Bedrock path — at `on_tool_start` we already have the finalized tool name and arguments, so the block is opened with full IN payload and `on_tool_end` matches it by `run_id` to attach OUT. The Anthropic streaming path is untouched (a matching pending block is found and consumed as before).

### Known limitation

- Parallel tool calls whose `args` chunks interleave across different `index`es will still be misrouted into the most recently opened `tool_use` block when relying on the streaming converter. Bedrock's `on_tool_start` fallback is unaffected (each tool gets its own block per `run_id`). Anthropic and serial OpenAI cases are unaffected.

## [0.2.20] - 2026-05-14

### Fixed

- **Trace webhook never sent for microservice graphs**: `LangGraphEngine.sendTraceFromAccumulator()` was reading `config.configurable?.context`, but the parameter is actually the full `IGraphRequestPayload` (shape `{requestId, input, config: {configurable: {context}}}`), so the path resolved to `undefined` and the webhook was always skipped. As a result, no trace events from microservices (e.g. `campaigns-automation`) ever reached the backend's `/internal/usage/trace-events/batch` endpoint, and the admin trace UI stayed empty for those graphs. Now reads from `preparedPayload.config?.configurable?.context` with a fallback to the legacy flat shape, mirroring `extractThreadId()`.

## [0.2.19] - 2026-04-24

### Fixed

- **LangGraph checkpointing**: `AbstractGraphBuilder.preparePayload()` now automatically sets `checkpoint_ns` (defaults to `graphType`) and `checkpoint_id` (defaults to `thread_id`) if not already provided. This ensures state persistence works correctly across graph invocations.
- **UniversalGraphModule**: `buildGraph()` now calls `preparePayload()` before `buildGraph()` to guarantee checkpoint configuration is set before graph compilation.

### Added

- Debug logging for checkpoint configuration in `AbstractGraphBuilder.preparePayload()`

## [0.2.17] - 2026-03-30

### Added

- `FLUTCH_API_TOKEN` env variable — universal API key for all providers, takes priority over provider-specific keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.)

### Changed

- **Conditional router routing**: providers only route through `router.flutch.ai` when `FLUTCH_API_TOKEN` is set or `FLUTCH_ROUTER_URL` / explicit `baseURL` is provided. Without these, providers go directly to their native APIs
- `resolveRouterURL()` now returns `undefined` when no router context is detected (was always returning `DEFAULT_ROUTER_URL`)
- `resolveApiKey()` priority: custom resolver > `FLUTCH_API_TOKEN` > provider-specific env var

## [0.2.16] - 2026-03-29

### Added

- `ModelConfig` interface — direct model initialization by `provider + modelName` without DB lookup / config fetcher
- `ToolConfig` type — flexible tool reference: string `"tool_name"` or object `{ name, enabled?, config? }`
- `normalizeToolConfigs()` — converts `ToolConfig[]` to internal `IAgentToolConfig[]` format
- `initializeChatModel()` now accepts `ModelConfig | ModelByIdConfig` (overloaded) with optional `customTools` parameter
- `baseUrl` parameter in `VoyageAIRerankConfig` for custom endpoint routing
- Exported `model.logic` utilities (`isReasoningModel`, `hashToolsConfig`, `normalizeToolConfigs`, `generateModelCacheKey`, `buildOpenAIModelConfig`, `resolveRouterURL`) from package index

### Changed

- **All providers now route through the internal gateway** (`router.flutch.ai`):
  - `COHERE` chat — uses `CohereClient` with `baseUrl` (LangChain wrapper doesn't expose this param directly)
  - `COHERE` rerank — same `CohereClient` approach
  - `VOYAGEAI` rerank — new `baseUrl` config passed as `{routerURL}/v1/rerank`
  - `OPENAI` embeddings — `configuration.baseURL` set to `{routerURL}/v1`
  - (OpenAI chat, Anthropic chat, Mistral chat were already routed in v0.2.12–0.2.15)
- `ModelByIdConfig` marked `@deprecated` — use `ModelConfig` with `provider + modelName` instead
- Legacy `initializeChatModelByIdInternal` refactored as private, cleaned up verbose debug logging

### Updated

- `@types/jest` ^29 → ^30, `@types/node` ^20 → ^25

## [0.2.15] - 2026-03-29

### Changed

- `MISTRAL` provider now routes through the gateway (`FLUTCH_ROUTER_URL`) via `serverURL` — previously called `api.mistral.ai` directly, bypassing the router

## [0.2.12] - 2026-03-29

### Added

- `baseURL` field on `ModelByIdConfig` and `ModelConfigWithToken` — allows overriding the LLM provider URL per call or per model config (e.g. route through `https://router.flutch.ai`)
- `resolveRouterURL` and `DEFAULT_ROUTER_URL` exported from `model.logic.ts`
- `baseURL` included in model instance cache key to prevent cache collisions when callers use different endpoints
- `OPENAI` and `ANTHROPIC` providers now support `baseURL` override via config or `FLUTCH_ROUTER_URL` env var

### Changed

- `generateModelCacheKey` now accepts an optional `baseURL` parameter

## [0.2.11] - 2026-03-25

### Added

- `OAuthProviderRegistry` — static provider registry with env-based config resolution
  - `loadOAuthProviders()` / `getOAuthProvider()` / `getOAuthProviderNames()`
  - `resolveOAuthProviderConfig()` — resolves provider config from environment variables
  - `buildOAuthAuthorizationUrl()` — builds OAuth authorization URL with scopes and state

## [0.2.10] - 2026-03-25

### Added

- OAuth token management module (`@flutch/node-sdk/oauth`)
  - `OAuthTokenManager` — handles token acquisition, refresh, and caching
  - `OAuthCryptoUtils` — encryption/decryption utilities for secure token storage
  - `FileTokenStore` — file-based token persistence
  - `MongoTokenStore` — MongoDB-based token persistence

## [0.2.9] - 2026-03-15

### Changed

- **BREAKING:** Moved NestJS packages (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`, `@nestjs/axios`, `@nestjs/mongoose`, `@nestjs/swagger`, `@nestjs/terminus`), `ioredis`, `mongoose`, `prom-client`, `reflect-metadata`, and `@willsoto/nestjs-prometheus` from `dependencies` to `peerDependencies` — consumers must now install these packages themselves
- Added NestJS v11 support in peer dependencies (`^10.0.0 || ^11.0.0` for core, common, platform-express; `^7.0.0 || ^11.0.0` for swagger)
- Replaced `@langchain/azure-openai` with `@langchain/aws` (`^1.3.1`) for AWS Bedrock support
- Added `ApiKeyResolver` callback type — allows injecting custom API key resolution instead of relying on `process.env` lookups
- `ModelInitializer` constructor now accepts optional `ApiKeyResolver` as third parameter
- Centralized API key resolution via `resolveApiKey()` method with `DEFAULT_ENV_MAP` fallback
- Simplified OpenAI model creation using `buildOpenAIModelConfig` pure function

### Added

- AWS Bedrock support via `ChatBedrockConverse` — models with `useBedrock: true` and `bedrockModelId` in config are routed to Bedrock
- `useBedrock` and `bedrockModelId` fields in `ModelConfigWithToken` interface

### Removed

- Removed `FLUTCH`, `FLUTCH_MISTRAL`, `FLUTCH_OPENAI`, `FLUTCH_ANTHROPIC` values from `ModelProvider` enum
- Removed GPT-5 monkey patch (~345 lines) from `ModelInitializer` — LangChain now natively supports GPT-5 models
- Removed `ModelConfig`, `ConcreteModels`, and `ModelCreator` types from `llm.types.ts`
- Removed concrete model imports (`ChatAnthropic`, `ChatCohere`, `ChatMistralAI`, `ChatOpenAI`) from `llm.types.ts`

## [0.2.8] - 2026-03-05

### Fixed

- Fixed `MappedChannels` type to match LangGraph v1.2 `BaseChannel` signature — added third type parameter and `OverwriteValue` support

## [0.2.7] - 2026-03-04

### Changed

- Upgraded LangChain dependencies to latest versions:
  - `@langchain/anthropic` ^0.3.33 → ^1.3.22
  - `@langchain/core` ^1.0.2 → ^1.1.30
  - `@langchain/langgraph` ^1.0.1 → ^1.2.0
  - `@langchain/openai` ^1.0.0 → ^1.2.12
  - `@langchain/cohere` ^1.0.0 → ^1.0.4
  - `@langchain/mistralai` ^1.0.0 → ^1.0.7
  - `@langchain/langgraph-checkpoint-mongodb` ^1.0.0 → 1.0.0 (pinned)
- Refactored `on_chain_end` handling in EventProcessor — metadata is now extracted from node return values via `output.metadata` field instead of from attachment wrapper formats (`answer`, `generation`)
- Removed attachment extraction from `on_chain_end` events — attachments are now exclusively handled via `send_attachments` custom events (introduced in v0.2.6)

### Removed

- Removed legacy attachment extraction paths from `on_chain_end` (`answer.attachments`, `generation.attachments`, flat `output.attachments`)

## [0.2.6] - 2026-02-20

### Added

- `dispatchAttachments` helper function for streaming attachments from LangGraph nodes without duplication
- Support for `send_attachments` custom event in EventProcessor for proper attachment handling

### Changed

- Refactored attachment extraction in EventProcessor - removed `on_chain_end` attachment extraction to prevent duplication
- Attachments are now dispatched via custom events (`send_attachments`) using `dispatchAttachments` helper
- Enhanced EventProcessor logging to include attachments count and data in final result

### Fixed

- Fixed attachment duplication issue - attachments are no longer extracted multiple times from different events
- Improved attachment streaming workflow - now uses dedicated custom event instead of relying on chain end events

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

## [0.1.11] - 2025-11-21

### Added

- Dynamic schema support for `ModelByIdConfig` — allows tools to declare schemas dynamically at runtime
- Dynamic schema support in tool catalog for flexible tool definitions

## [0.1.10] - 2025-11-18

### Changed

- Refactored content stream processing with text buffer approach for simplified event handling
- Unified content blocks across `TEXT` and `PROCESSING` channels

### Fixed

- Corrected tool input/output streaming semantics for accurate event processing

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

[Unreleased]: https://github.com/flutchai/node-sdk/compare/v0.2.17...HEAD
[0.2.17]: https://github.com/flutchai/node-sdk/compare/v0.2.16...v0.2.17
[0.2.16]: https://github.com/flutchai/node-sdk/compare/v0.2.15...v0.2.16
[0.2.9]: https://github.com/flutchai/node-sdk/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/flutchai/node-sdk/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/flutchai/node-sdk/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/flutchai/node-sdk/compare/v0.2.5...v0.2.6
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
[0.1.12]: https://github.com/flutchai/node-sdk/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/flutchai/node-sdk/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/flutchai/node-sdk/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/flutchai/node-sdk/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/flutchai/node-sdk/compare/v0.1.6...v0.1.8
[0.1.6]: https://github.com/flutchai/node-sdk/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/flutchai/node-sdk/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/flutchai/node-sdk/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/flutchai/node-sdk/releases/tag/v0.1.3
