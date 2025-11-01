import { ModelProvider } from "./enums";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatCohere } from "@langchain/cohere";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

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
