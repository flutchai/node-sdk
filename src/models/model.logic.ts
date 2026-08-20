/**
 * Pure business logic for ModelInitializer — no I/O, no DI, no LangChain imports.
 * Easily testable without mocks.
 */

import { createHash } from "crypto";
import { IAgentToolConfig } from "../tools/config";
import { ToolConfig } from "./llm.types";

/**
 * Check if a model name refers to a "reasoning model" that requires
 * maxCompletionTokens instead of maxTokens, and temperature = 1.
 */
export function isReasoningModel(modelName: string): boolean {
  return (
    modelName.includes("gpt-5") ||
    modelName.includes("gpt-o1") ||
    modelName.includes("gpt-o2") ||
    modelName.includes("gpt-o3") ||
    modelName.includes("gpt-o4") ||
    /^gpt-(5|6|7|8|9)/.test(modelName) ||
    /^gpt-o[1-4]/.test(modelName)
  );
}

/**
 * Coerce a value to a number, treating "absent" as undefined instead of NaN.
 *
 * `Number(undefined)` is `NaN`, and `NaN` sent to a provider is either
 * rejected or silently turns into a default — so an absent value must stay
 * absent all the way down to the provider constructor.
 */
export function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Anthropic model families that dropped sampling parameters.
 *
 * Starting with Claude Opus 4.7 (and the whole Claude 5 generation) Anthropic
 * removed `temperature` / `top_p` / `top_k` from the request surface. Sending
 * any of them is a hard error:
 *
 *   ValidationException: The model returned the following errors:
 *   `temperature` is deprecated for this model.
 *
 * Rather than a hardcoded list of exact model strings (which goes stale on every
 * release), we match the family + version encoded in the model identifier and
 * compare it against the first version of that family that dropped sampling
 * params. Anything at or above the threshold — including future releases — is
 * treated as "no sampling params".
 *
 * Thresholds (family → first version WITHOUT sampling params):
 *   opus    → 4.7   (4.6 and older still accept temperature)
 *   sonnet  → 5.0   (4.6 / 4.5 and older still accept temperature)
 *   haiku   → 5.0   (4.5 and older still accept temperature)
 *
 * Families with no numeric generation in the name (`fable`, `mythos`) shipped
 * after the removal and never accept sampling params at any version.
 */
export const SAMPLING_PARAM_FREE_THRESHOLDS: Record<
  string,
  { major: number; minor: number }
> = {
  opus: { major: 4, minor: 7 },
  sonnet: { major: 5, minor: 0 },
  haiku: { major: 5, minor: 0 },
};

/**
 * Families that never accept sampling parameters, regardless of version.
 */
const SAMPLING_PARAM_FREE_FAMILIES = /claude-(fable|mythos)\b/;

/**
 * Matches `claude-<family>-<major>[-<minor>]` inside any provider-flavoured
 * model identifier:
 *
 *   claude-opus-4-7                                  → opus 4.7
 *   claude-opus-5                                    → opus 5.0
 *   us.anthropic.claude-opus-4-7-20260101-v1:0       → opus 4.7
 *   anthropic.claude-sonnet-4-5-20250929-v1:0        → sonnet 4.5
 *   claude-opus-4-7@20260101 (Vertex)                → opus 4.7
 *
 * The `(?![\d.])` guard after the minor group keeps a trailing date snapshot
 * from being read as a minor version: in `claude-opus-4-20250514` the `20250514`
 * is rejected as a minor, so the model resolves to opus 4.0 (which still
 * accepts temperature) instead of a bogus opus 4.20250514.
 *
 * Legacy naming (`claude-3-5-sonnet-*`, `claude-3-7-sonnet-*`) does not match
 * at all, so those models keep their sampling parameters.
 */
const CLAUDE_FAMILY_VERSION =
  /claude-(opus|sonnet|haiku)-(\d{1,2})(?:-(\d{1,2}))?(?![\d.])/;

/**
 * Does this model accept sampling parameters (`temperature` / `top_p` / `top_k`)?
 *
 * Returns `true` for everything the SDK does not explicitly know to reject them
 * — non-Anthropic providers, legacy Claude naming, and every Claude release
 * below its family threshold — so existing models keep today's behaviour.
 */
export function modelAcceptsSamplingParams(modelIdentifier?: string): boolean {
  if (!modelIdentifier) return true;

  const id = modelIdentifier.toLowerCase();

  if (SAMPLING_PARAM_FREE_FAMILIES.test(id)) return false;

  const match = CLAUDE_FAMILY_VERSION.exec(id);
  if (!match) return true;

  const [, family, majorRaw, minorRaw] = match;
  const threshold = SAMPLING_PARAM_FREE_THRESHOLDS[family];
  if (!threshold) return true;

  const major = Number(majorRaw);
  const minor = minorRaw === undefined ? 0 : Number(minorRaw);

  const atOrAboveThreshold =
    major > threshold.major ||
    (major === threshold.major && minor >= threshold.minor);

  return !atOrAboveThreshold;
}

/**
 * Bedrock prompt caching (Converse `cachePoint`) — first Claude version per
 * family that supports it.
 *
 * A cache point marks the end of a static prompt prefix. Bedrock chains the
 * three cacheable sections in the order `tools` → `system` → `messages`, so a
 * checkpoint after the tool schemas is re-read by every request that binds the
 * same tools — across tenants and across the steps of one agentic turn. Reads
 * are billed at 10% of the input rate, writes at 1.25x, and the entry's TTL
 * resets on every hit.
 *
 * Measured on the zetap console assistant (65 tools, us.anthropic.claude-opus-5,
 * us-east-2): the tools block alone is 24 575 tokens and the system prompt
 * another 5 040, i.e. ~29.6k input tokens re-sent on EVERY LLM call of every
 * turn. Caching turns that into ~2 960 billable tokens per call.
 *
 * Thresholds (family → first version that supports `cachePoint`):
 *   opus    → 4.0
 *   sonnet  → 4.0
 *   haiku   → 4.5
 *
 * Below the threshold, on legacy naming (`claude-3-5-sonnet-*`) and on every
 * non-Claude Bedrock model the answer is "no": an unsupported model rejects a
 * `cachePoint` block outright, so the conservative default is to send none.
 * `promptCache: true` forces it on for a model the SDK does not recognise yet.
 */
export const PROMPT_CACHE_MIN_VERSIONS: Record<
  string,
  { major: number; minor: number }
> = {
  opus: { major: 4, minor: 0 },
  sonnet: { major: 4, minor: 0 },
  haiku: { major: 4, minor: 5 },
};

/** TTL of a Bedrock cache checkpoint. Claude models accept both values. */
export type PromptCacheTtl = "5m" | "1h";

/**
 * Cache-control payload, shaped to satisfy both providers at once:
 * `ChatBedrockConverse.cache_control` (call option, `type` optional) and
 * `ChatAnthropic.cache_control` (constructor field, `type` required). The
 * Anthropic form is the top-level parameter, which puts a breakpoint on the
 * last cacheable block and advances it as the conversation grows — verified
 * against Bedrock's InvokeModel body schema, which accepts it.
 */
export interface PromptCacheControl {
  type: "ephemeral";
  ttl?: PromptCacheTtl;
}

/**
 * Does this model support Bedrock prompt caching?
 *
 * Returns `false` for anything the SDK does not explicitly know to support it,
 * which is the safe direction: a missing cache point costs money, an unsupported
 * one fails the request.
 */
export function modelSupportsPromptCache(modelIdentifier?: string): boolean {
  if (!modelIdentifier) return false;

  const match = CLAUDE_FAMILY_VERSION.exec(modelIdentifier.toLowerCase());
  if (!match) return false;

  const [, family, majorRaw, minorRaw] = match;
  const threshold = PROMPT_CACHE_MIN_VERSIONS[family];
  if (!threshold) return false;

  const major = Number(majorRaw);
  const minor = minorRaw === undefined ? 0 : Number(minorRaw);

  return (
    major > threshold.major ||
    (major === threshold.major && minor >= threshold.minor)
  );
}

/**
 * Decide whether to cache the request prefix, and with which TTL.
 *
 * `modelIdentifiers` accepts every name the model is known by (catalog model
 * name, Bedrock model id, …) — caching is enabled when *any* of them is a
 * known-supporting model.
 *
 * `promptCache` is the config-level escape hatch and always wins:
 *   - `true`  → cache even if the identifier is unknown to the SDK
 *   - `false` → never cache
 *   - absent  → decide from the model identifier
 *
 * Returns `undefined` when no cache points should be sent.
 */
export function resolvePromptCacheControl(
  modelIdentifiers: (string | undefined)[],
  promptCache?: boolean,
  ttl?: PromptCacheTtl
): PromptCacheControl | undefined {
  const enabled =
    promptCache ?? modelIdentifiers.some(id => modelSupportsPromptCache(id));

  return enabled ? { type: "ephemeral", ttl: ttl ?? "5m" } : undefined;
}

/**
 * Reasoning-effort levels accepted by `output_config.effort`.
 *
 * Effort controls how much the model thinks before answering, and thinking
 * tokens are billed as output. Measured on Bedrock (us.anthropic.claude-opus-5,
 * one analytical question, 4096 max tokens): `high` — the default — produced
 * 2 398 output tokens, `xhigh` 1 884, `medium` 1 205, `low` 1 191.
 *
 * Two operational notes before turning this into a per-turn router:
 *   - effort is part of the Bedrock prompt-cache key, so alternating levels on
 *     one agent re-writes the cached prefix on every switch;
 *   - lower effort means shallower multi-step tool work, which is exactly what
 *     the console assistant does. Pick one level per agent and A/B it.
 */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Build the `additionalModelRequestFields` payload that carries the effort
 * level through the Converse API, or `undefined` when no effort is configured.
 *
 * Only sent when explicitly asked for: the catalog default stays "whatever the
 * model does on its own" (`high` for Claude Opus 5), so no existing agent
 * changes behaviour. Models that do not accept `output_config` reject the
 * request rather than silently ignoring it — deliberate, because a silently
 * dropped effort reads as a saving that never happened.
 */
export function buildEffortRequestFields(
  effort?: ReasoningEffort
): { output_config: { effort: ReasoningEffort } } | undefined {
  return effort ? { output_config: { effort } } : undefined;
}

export interface SamplingParams {
  temperature?: number;
  topP?: number;
  topK?: number;
}

export interface ResolvedSamplingParams {
  /** Params safe to hand to the provider. Empty when the model rejects them. */
  params: SamplingParams;
  /** Names of params that were requested but dropped (for logging). */
  dropped: string[];
  /** Whether the model was judged to accept sampling params. */
  accepted: boolean;
}

/**
 * Decide which sampling parameters may be sent to a model.
 *
 * `modelIdentifiers` accepts every name the model is known by (catalog model
 * name, Bedrock model id, …) — if *any* of them looks like a sampling-param-free
 * model, the params are dropped.
 *
 * `supportsSamplingParams` is the config-level escape hatch and always wins:
 *   - `true`  → send the params even if the identifier says otherwise
 *   - `false` → never send them
 *   - absent  → decide from the model identifier
 */
export function resolveSamplingParams(
  modelIdentifiers: (string | undefined)[],
  requested: SamplingParams,
  supportsSamplingParams?: boolean
): ResolvedSamplingParams {
  const accepted =
    supportsSamplingParams ??
    modelIdentifiers.every(id => modelAcceptsSamplingParams(id));

  if (accepted) {
    const params: SamplingParams = {};
    if (requested.temperature !== undefined)
      params.temperature = requested.temperature;
    if (requested.topP !== undefined) params.topP = requested.topP;
    if (requested.topK !== undefined) params.topK = requested.topK;
    return { params, dropped: [], accepted: true };
  }

  const dropped = (["temperature", "topP", "topK"] as const).filter(
    key => requested[key] !== undefined
  );

  return { params: {}, dropped, accepted: false };
}

/**
 * Generate a stable MD5-based hash of a tools configuration array.
 * Used as part of the model instance cache key.
 */
export function hashToolsConfig(toolsConfig: IAgentToolConfig[]): string {
  const sorted = toolsConfig
    .map(t => `${t.toolName}:${t.enabled}:${JSON.stringify(t.config || {})}`)
    .sort()
    .join("|");

  return createHash("md5").update(sorted).digest("hex").slice(0, 16);
}

/**
 * Normalize flexible ToolConfig[] (from graph configs) into IAgentToolConfig[] (SDK internal format).
 */
export function normalizeToolConfigs(
  tools?: ToolConfig[]
): IAgentToolConfig[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t =>
    typeof t === "string"
      ? { toolName: t, enabled: true }
      : { toolName: t.name, enabled: t.enabled !== false, config: t.config }
  );
}

export const DEFAULT_ROUTER_URL = "https://router.flutch.ai";

/**
 * Resolve the router base URL.
 * Priority: explicit baseURL arg > FLUTCH_ROUTER_URL env > DEFAULT_ROUTER_URL.
 * Returns undefined when FLUTCH_API_TOKEN is not set and no explicit baseURL
 * is provided — callers should skip router and go directly to the provider.
 */
export function resolveRouterURL(baseURL?: string): string | undefined {
  if (baseURL) return baseURL;
  if (process.env.FLUTCH_ROUTER_URL) return process.env.FLUTCH_ROUTER_URL;
  if (process.env.FLUTCH_API_TOKEN) return DEFAULT_ROUTER_URL;
  return undefined;
}

/**
 * Generate a cache key for a model instance.
 * Format: "modelId:temperature:maxTokens[:baseURL][:toolsHash]"
 */
export function generateModelCacheKey(
  modelId: string,
  temperature?: number,
  maxTokens?: number,
  toolsConfig?: IAgentToolConfig[],
  baseURL?: string
): string {
  const parts: (string | number)[] = [
    modelId,
    temperature ?? "default",
    maxTokens ?? "default",
  ];

  if (baseURL) {
    parts.push(baseURL);
  }

  if (toolsConfig && toolsConfig.length > 0) {
    parts.push(hashToolsConfig(toolsConfig));
  }

  return parts.join(":");
}

/**
 * Build the constructor config object for a ChatOpenAI instance.
 * Returns different shapes for reasoning models (GPT-5+) vs legacy models.
 */
export function buildOpenAIModelConfig(
  modelName: string,
  temperature: number | undefined,
  maxTokens: number | undefined,
  apiToken: string
): Record<string, any> {
  if (isReasoningModel(modelName)) {
    return {
      modelName,
      temperature: 1, // Reasoning models only support temperature=1
      maxCompletionTokens: maxTokens,
      streaming: true,
      openAIApiKey: apiToken,
    };
  }

  return {
    modelName,
    // Omit the key entirely when absent — an explicit `undefined` would still
    // be enumerable and can be forwarded as a null-ish value downstream.
    ...(temperature !== undefined && { temperature }),
    maxTokens,
    streaming: true,
    openAIApiKey: apiToken,
  };
}
