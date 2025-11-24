import { ModelProvider } from "./enums";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatCohere } from "@langchain/cohere";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatOpenAI } from "@langchain/openai";
import {
  BaseChatModel,
  BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { IAgentToolConfig } from "../tools";
import { Runnable } from "@langchain/core/runnables";
import { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessageChunk } from "@langchain/core/messages";

export interface ModelConfig {
  name: string;
  modelProvider: ModelProvider;
  temperature?: number;
  maxTokens?: number;
}

// Interface for initialization by model ID
export interface ModelByIdConfig {
  modelId: string;
  temperature?: number;
  maxTokens?: number;
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
}

// Use BaseChatModel which has withStructuredOutput method
export type LLModel = BaseChatModel;

// Keep concrete types for backward compatibility
export type ConcreteModels =
  | ChatOpenAI
  | ChatAnthropic
  | ChatCohere
  | ChatMistralAI;

export type ModelCreator = (
  config: ModelConfig & { customApiToken?: string }
) => LLModel;
