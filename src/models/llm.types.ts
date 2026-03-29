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

// Interface for initialization by model ID
export interface ModelByIdConfig {
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  /** Optional custom base URL for the LLM provider. Overrides model config and FLUTCH_ROUTER_URL env. */
  baseURL?: string;
  // Optional: tools from agent config (with settings for dynamic schemas)
  toolsConfig?: IAgentToolConfig[];
  // Optional: custom tools already prepared as DynamicStructuredTool
  customTools?: DynamicStructuredTool[];
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
  defaultTemperature: number;
  defaultMaxTokens: number;
  apiToken?: string;
  requiresApiKey: boolean;
  // Bedrock routing
  useBedrock?: boolean;
  bedrockModelId?: string;
  /** Optional custom base URL for the LLM provider (e.g. self-hosted gateway). Falls back to FLUTCH_ROUTER_URL env or https://router.flutch.ai */
  baseURL?: string;
}

// Callback to resolve API keys by provider (replaces scattered process.env lookups)
export type ApiKeyResolver = (provider: ModelProvider) => string | undefined;

// Use BaseChatModel which has withStructuredOutput method
export type LLModel = BaseChatModel;
