import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatMistralAI } from "@langchain/mistralai";

/**
 * Supported LLM providers
 */
export type LLMProvider = "openai" | "anthropic" | "mistral";

/**
 * Configuration for model initialization
 */
export interface ModelConfig {
  provider: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Default models for each provider
 */
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-haiku-20240307",
  mistral: "mistral-small-latest",
};

/**
 * Factory for creating LLM instances
 */
export class ModelFactory {
  /**
   * Create a chat model based on provider
   */
  static createModel(config: ModelConfig): BaseChatModel {
    const {
      provider,
      model = DEFAULT_MODELS[provider],
      temperature = 0.7,
      maxTokens = 2048,
    } = config;

    switch (provider) {
      case "openai":
        return new ChatOpenAI({
          modelName: model,
          temperature,
          maxTokens,
          streaming: true,
        });

      case "anthropic":
        return new ChatAnthropic({
          modelName: model,
          temperature,
          maxTokens,
        }) as unknown as BaseChatModel;

      case "mistral":
        return new ChatMistralAI({
          model,
          temperature,
          maxTokens,
        });

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  /**
   * Get available providers (those with API keys configured)
   */
  static getAvailableProviders(): LLMProvider[] {
    const providers: LLMProvider[] = [];

    if (process.env.OPENAI_API_KEY) {
      providers.push("openai");
    }
    if (process.env.ANTHROPIC_API_KEY) {
      providers.push("anthropic");
    }
    if (process.env.MISTRAL_API_KEY) {
      providers.push("mistral");
    }

    return providers;
  }

  /**
   * Check if a provider is available
   */
  static isProviderAvailable(provider: LLMProvider): boolean {
    return this.getAvailableProviders().includes(provider);
  }
}
