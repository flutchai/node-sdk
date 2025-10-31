import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatCohere } from "@langchain/cohere";
import {
  LLModel,
  ModelConfig,
  ModelCreator,
  ModelByIdConfig,
  ModelConfigFetcher,
  ModelConfigWithToken,
} from "./llm.types";
import { ILLMInitializer } from "./llm.interface";
import { ModelProvider } from "../shared-types";
import { ChatMistralAI } from "@langchain/mistralai";
import { Logger } from "@nestjs/common";

export class LLMInitializer implements ILLMInitializer {
  private readonly logger = new Logger(LLMInitializer.name);

  constructor(private configFetcher?: ModelConfigFetcher) {}

  /**
   * TEMPORARY SOLUTION for compatibility with new OpenAI models
   *
   * OpenAI changed the API for new models (gpt-5, o-series):
   * - Old models (gpt-3.5, gpt-4, gpt-4o): use maxTokens
   * - New models (gpt-5, gpt-o1, gpt-o3, gpt-o4): use maxCompletionTokens
   *
   * This is a hardcoded solution, but so far the only issue is with OpenAI
   * and only with this parameter. If other parameter issues arise with
   * other providers - we'll need to implement an adapter system.
   *
   * @param modelName - OpenAI model name
   * @returns true if model requires maxCompletionTokens
   */
  private requiresMaxCompletionTokens(modelName: string): boolean {
    return (
      modelName.includes("gpt-5") ||
      modelName.includes("gpt-o1") ||
      modelName.includes("gpt-o2") ||
      modelName.includes("gpt-o3") ||
      modelName.includes("gpt-o4") ||
      // Add other patterns as new models are released
      /^gpt-(5|6|7|8|9)/.test(modelName) ||
      /^gpt-o[1-4]/.test(modelName)
    );
  }

  private readonly modelProviders: Partial<
    Record<ModelProvider, ModelCreator>
  > = {
    [ModelProvider.OPENAI]: ({
      name,
      temperature,
      maxTokens,
      customApiToken,
    }) => {
      const config: any = {
        modelName: name,
        temperature,
        streaming: true,
        openAIApiKey: customApiToken || process.env.OPENAI_API_KEY,
      };

      // HARDCODED: Choose the correct parameter for tokens
      if (this.requiresMaxCompletionTokens(name)) {
        config.maxCompletionTokens = maxTokens;
        this.logger.log(`Using maxCompletionTokens for ${name}: ${maxTokens}`);
      } else {
        config.maxTokens = maxTokens;
      }

      return new ChatOpenAI(config);
    },
    [ModelProvider.ANTHROPIC]: ({
      name,
      temperature,
      maxTokens,
      customApiToken,
    }) =>
      new ChatAnthropic({
        modelName: name,
        temperature,
        maxTokens,
        anthropicApiKey: customApiToken || process.env.ANTHROPIC_API_KEY,
      }),
    [ModelProvider.FLUTCH_ANTHROPIC]: ({
      name,
      temperature,
      maxTokens,
      customApiToken,
    }) =>
      new ChatAnthropic({
        modelName: name,
        temperature,
        maxTokens,
        anthropicApiKey: customApiToken || process.env.ANTHROPIC_API_KEY,
      }),
    [ModelProvider.MISTRAL]: ({
      name,
      temperature,
      maxTokens,
      customApiToken,
    }) =>
      new ChatMistralAI({
        model: name,
        temperature,
        maxTokens,
        apiKey: customApiToken || process.env.MISTRAL_API_KEY,
      }),
    [ModelProvider.FLUTCH_MISTRAL]: ({
      name,
      temperature,
      maxTokens,
      customApiToken,
    }) =>
      new ChatMistralAI({
        model: name,
        temperature,
        maxTokens,
        apiKey: customApiToken || process.env.MISTRAL_API_KEY,
      }),
    [ModelProvider.FLUTCH_OPENAI]: ({
      name,
      temperature,
      maxTokens,
      customApiToken,
    }) => {
      const config: any = {
        modelName: name,
        temperature,
        streaming: true,
        openAIApiKey: customApiToken || process.env.OPENAI_API_KEY,
      };

      // HARDCODED: Same mapping as for regular OpenAI
      if (this.requiresMaxCompletionTokens(name)) {
        config.maxCompletionTokens = maxTokens;
        this.logger?.log(
          `Using maxCompletionTokens for FLUTCH ${name}: ${maxTokens}`
        );
      } else {
        config.maxTokens = maxTokens;
      }

      return new ChatOpenAI(config);
    },
    // AWS Bedrock support removed - use Anthropic or OpenAI directly instead
    [ModelProvider.COHERE]: ({
      name,
      temperature,
      maxTokens,
      customApiToken,
    }) =>
      new ChatCohere({
        model: name,
        temperature,
        // Cohere ChatCohere does not support maxTokens parameter
        apiKey: customApiToken || process.env.COHERE_API_KEY,
      }),
    [ModelProvider.FLUTCH]: () => {
      throw new Error("Not yet implemented");
    },
    [ModelProvider.VOYAGEAI]: () => {
      throw new Error(
        "VoyageAI is only used for reranking, not for chat models"
      );
    },
  } as const;

  initializeModel(config: ModelConfig): LLModel {
    this.logger.log(
      `LLMInitializer init model: ${config.modelProvider} - ${config.name}`
    );
    const provider = this.modelProviders[config.modelProvider];

    if (!provider) {
      throw new Error(`Unsupported provider ${config.modelProvider}`);
    }

    return provider(config);
  }

  async initializeModelById(config: ModelByIdConfig): Promise<LLModel> {
    this.logger.log(`Initializing model by ID: ${config.modelId}`);

    try {
      // Get model configuration
      const modelConfig = this.configFetcher
        ? await this.configFetcher(config.modelId)
        : await this.fetchFromApi(config.modelId);

      this.logger.log(`Retrieved model config for ${config.modelId}`, {
        modelName: modelConfig.modelName,
        provider: modelConfig.provider,
        hasApiToken: !!modelConfig.apiToken,
        requiresApiKey: modelConfig.requiresApiKey,
      });

      // Create final configuration with passed parameters
      const initConfig = {
        name: modelConfig.modelName,
        modelProvider: modelConfig.provider,
        // IMPORTANT: use passed temperature and maxTokens or defaults
        // Convert to numbers to handle string values from configs
        temperature: Number(
          config.temperature ?? modelConfig.defaultTemperature
        ),
        maxTokens: Number(config.maxTokens ?? modelConfig.defaultMaxTokens),
        customApiToken: modelConfig.apiToken,
      };

      return this.initializeModelWithCustomToken(initConfig);
    } catch (error) {
      this.logger.error(
        `Failed to initialize model ${config.modelId}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  // Simple API request for microservices
  private async fetchFromApi(modelId: string): Promise<ModelConfigWithToken> {
    const apiUrl = process.env.API_URL || "http://amelie-service";
    const token = process.env.INTERNAL_API_TOKEN;

    if (!token) {
      throw new Error("INTERNAL_API_TOKEN required for API mode");
    }

    const url = `${apiUrl}/internal/model-catalog/models/${modelId}/config`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-internal-token": token,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch model config: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  private initializeModelWithCustomToken(
    config: ModelConfig & { customApiToken?: string }
  ): LLModel {
    const provider = this.modelProviders[config.modelProvider];

    if (!provider) {
      throw new Error(`Unsupported provider ${config.modelProvider}`);
    }

    // Create configuration with custom token if available
    const providerConfig = {
      name: config.name,
      modelProvider: config.modelProvider,
      temperature: Number(config.temperature),
      maxTokens: Number(config.maxTokens),
      customApiToken: config.customApiToken,
    };

    return provider(providerConfig);
  }

  check(): string {
    return "LLMInitializer check";
  }
}
