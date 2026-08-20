import { ModelProvider } from "./enums";
import {
  BaseChatModel,
  BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { IAgentToolConfig } from "../tools";
import { Runnable } from "@langchain/core/runnables";
import { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessageChunk } from "@langchain/core/messages";
import { PromptCacheTtl, ReasoningEffort } from "./model.logic";

// ── New: direct model initialization by provider + name ──

/** Flexible tool reference for graph configs */
export type ToolConfig =
  | string
  | { name: string; enabled?: boolean; config?: Record<string, any> };

/** Serializable model config — used for config storage and initialization */
export interface ModelConfig {
  provider: ModelProvider;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  tools?: ToolConfig[];
  /** Optional custom base URL for the LLM provider */
  baseURL?: string;
  /** Provider-specific params passed through to LangChain constructor */
  providerConfig?: Record<string, any>;
  /**
   * Override the automatic sampling-parameter detection.
   * `false` — never send temperature/topP/topK (Claude Opus 4.7+, Claude 5).
   * `true`  — always send them, even if the model id suggests otherwise.
   * Absent  — decided from the model identifier (see `modelAcceptsSamplingParams`).
   */
  supportsSamplingParams?: boolean;
}

// ── Legacy: initialization by model ID (DB lookup) ──

/**
 * @deprecated Use ModelConfig with provider + modelName instead
 */
export interface ModelByIdConfig {
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Override the automatic sampling-parameter detection for this call.
   * See `ModelConfig.supportsSamplingParams`.
   */
  supportsSamplingParams?: boolean;
  /** Optional custom base URL for the LLM provider. Overrides model config and FLUTCH_ROUTER_URL env. */
  baseURL?: string;
  // Optional: tools from agent config (with settings for dynamic schemas)
  toolsConfig?: IAgentToolConfig[];
  // Optional: custom tools already prepared as DynamicStructuredTool
  customTools?: DynamicStructuredTool[];
  /**
   * Optional: inline per-tenant streamable-http MCP server configs. Forwarded
   * to mcp-runtime's /tools/schemas so their tools are discovered and bound
   * alongside static tools. Part of the model cache key.
   */
  mcpServers?: Record<string, any>[];
  /** Optional: context (companyId/agentId) for resolving inline server creds. */
  mcpContext?: Record<string, any>;
  /**
   * Override Bedrock prompt caching for this call.
   * `true` — send cache points even if the SDK does not recognise the model.
   * `false` — never send them.
   * Absent — decided from the model identifier (see `modelSupportsPromptCache`).
   */
  promptCache?: boolean;
  /** TTL of the cache checkpoints. Defaults to Bedrock's 5 minutes. */
  promptCacheTtl?: PromptCacheTtl;
  /**
   * Reasoning effort for this call (Bedrock Converse `output_config.effort`).
   * Absent — the model's own default (`high` on Claude Opus 5).
   */
  effort?: ReasoningEffort;
}

// Simple fetcher function type - only modelId parameter
export type ModelConfigFetcher = (
  modelId: string
) => Promise<ModelConfigWithToken>;

// Model configuration with token
export interface ModelConfigWithToken {
  modelId: string;
  modelName: string;
  provider: ModelProvider;
  /**
   * Absent means "do not send a temperature" — the SDK never coerces a missing
   * value into a number (that used to produce `NaN`).
   */
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  apiToken?: string;
  requiresApiKey: boolean;
  /**
   * Optional capability flag from the model catalog. Overrides the SDK's
   * identifier-based detection of sampling-parameter support.
   * See `ModelConfig.supportsSamplingParams`.
   */
  supportsSamplingParams?: boolean;
  // Bedrock routing
  useBedrock?: boolean;
  bedrockModelId?: string;
  /**
   * Optional capability flag from the model catalog. Overrides the SDK's
   * identifier-based detection of Bedrock prompt-cache support.
   * See `ModelByIdConfig.promptCache`.
   */
  promptCache?: boolean;
  /** Optional catalog default for the cache checkpoint TTL. */
  promptCacheTtl?: PromptCacheTtl;
  /** Optional catalog default for the reasoning effort. */
  defaultEffort?: ReasoningEffort;
  /** Optional custom base URL for the LLM provider (e.g. self-hosted gateway). Falls back to FLUTCH_ROUTER_URL env or https://router.flutch.ai */
  baseURL?: string;
}

// Callback to resolve API keys by provider (replaces scattered process.env lookups)
export type ApiKeyResolver = (provider: ModelProvider) => string | undefined;

// Use BaseChatModel which has withStructuredOutput method
export type LLModel = BaseChatModel;
