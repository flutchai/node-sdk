import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseDocumentCompressor } from "@langchain/core/retrievers/document_compressors";
import { Embeddings } from "@langchain/core/embeddings";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { ChatBedrockConverse } from "@langchain/aws";
import { Logger } from "@nestjs/common";
import { StructuredTool, DynamicStructuredTool } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessageChunk } from "@langchain/core/messages";
import { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import { McpToolFilter } from "../tools/mcp-tool-filter";
import { IAgentToolConfig } from "../tools/config";
import {
  isReasoningModel,
  hashToolsConfig as hashToolsConfigPure,
  generateModelCacheKey as generateModelCacheKeyPure,
  buildOpenAIModelConfig,
  resolveRouterURL,
  normalizeToolConfigs,
} from "./model.logic";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatCohere } from "@langchain/cohere";
import { CohereRerank } from "@langchain/cohere";
import { CohereClient } from "cohere-ai";
import { VoyageAIRerank } from "./rerankers/voyageai-rerank";
import { ChatMistralAI } from "@langchain/mistralai";

import { ModelProvider, ModelType } from "./enums";
import {
  IModelInitializer,
  Model,
  ModelByIdWithTypeConfig,
  ModelConfigWithTokenAndType,
  ChatModelCreator,
  RerankModelCreator,
  EmbeddingModelCreator,
  ChatModelOrRunnable,
} from "./model.interface";
import {
  ModelByIdConfig,
  ModelConfig,
  ModelConfigFetcher,
  ApiKeyResolver,
} from "./llm.types";

export class ModelInitializer implements IModelInitializer {
  private logger: Logger;

  // Cache for model configurations to avoid repeated API calls
  private modelConfigCache = new Map<string, ModelConfigWithTokenAndType>();

  // Cache for model instances to avoid recreating identical models
  private modelInstanceCache = new Map<string, Model>();

  private static readonly DEFAULT_ENV_MAP: Partial<
    Record<ModelProvider, string>
  > = {
    [ModelProvider.OPENAI]: "OPENAI_API_KEY",
    [ModelProvider.ANTHROPIC]: "ANTHROPIC_API_KEY",
    [ModelProvider.MISTRAL]: "MISTRAL_API_KEY",
    [ModelProvider.COHERE]: "COHERE_API_KEY",
    [ModelProvider.VOYAGEAI]: "VOYAGEAI_API_KEY",
  };

  constructor(
    private configFetcher?: ModelConfigFetcher,
    logger?: Logger,
    private apiKeyResolver?: ApiKeyResolver
  ) {
    this.logger = logger || new Logger(ModelInitializer.name);
  }

  /**
   * Resolve API key for a provider.
   * Uses custom resolver if provided, falls back to process.env.
   */
  private resolveApiKey(provider: ModelProvider): string | undefined {
    if (this.apiKeyResolver) {
      return this.apiKeyResolver(provider);
    }
    const envVar = ModelInitializer.DEFAULT_ENV_MAP[provider];
    return envVar ? process.env[envVar] : undefined;
  }

  /**
   * Resolve AWS region for Bedrock.
   */
  private resolveBedrockRegion(): string {
    return (
      process.env.BEDROCK_AWS_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-east-1"
    );
  }

  /**
   * Generate hash from toolsConfig for cache key
   * Uses MD5 hash to create short, unique identifier
   */
  private hashToolsConfig(toolsConfig: IAgentToolConfig[]): string {
    return hashToolsConfigPure(toolsConfig);
  }

  /**
   * Generate cache key from ModelByIdConfig
   * Format: modelId:temperature:maxTokens[:toolsHash]
   * Example: "model123:0.7:4096" or "model123:0.7:4096:a1b2c3d4e5f6g7h8"
   */
  private generateModelCacheKey(config: ModelByIdConfig): string {
    return generateModelCacheKeyPure(
      config.modelId,
      config.temperature,
      config.maxTokens,
      config.toolsConfig,
      config.baseURL
    );
  }

  // Chat model creators
  private readonly chatModelCreators: Partial<
    Record<ModelProvider, ChatModelCreator>
  > = {
    [ModelProvider.OPENAI]: ({
      modelName,
      defaultTemperature,
      defaultMaxTokens,
      apiToken,
      baseURL,
    }) => {
      const config = buildOpenAIModelConfig(
        modelName,
        defaultTemperature,
        defaultMaxTokens,
        apiToken || this.resolveApiKey(ModelProvider.OPENAI) || ""
      );
      config.configuration = { baseURL: `${resolveRouterURL(baseURL)}/v1` };
      return new ChatOpenAI(config);
    },

    [ModelProvider.ANTHROPIC]: ({
      modelName,
      defaultTemperature,
      defaultMaxTokens,
      apiToken,
      baseURL,
    }) =>
      new ChatAnthropic({
        modelName,
        temperature: defaultTemperature,
        maxTokens: defaultMaxTokens,
        anthropicApiKey:
          apiToken || this.resolveApiKey(ModelProvider.ANTHROPIC),
        anthropicApiUrl: resolveRouterURL(baseURL),
      }) as unknown as BaseChatModel,

    [ModelProvider.COHERE]: ({
      modelName,
      defaultTemperature,
      defaultMaxTokens,
      apiToken,
      baseURL,
    }) =>
      new ChatCohere({
        model: modelName,
        temperature: defaultTemperature,
        client: new CohereClient({
          token: apiToken || this.resolveApiKey(ModelProvider.COHERE),
          baseUrl: resolveRouterURL(baseURL),
        }),
      }),

    [ModelProvider.MISTRAL]: ({
      modelName,
      defaultTemperature,
      defaultMaxTokens,
      apiToken,
      baseURL,
    }) =>
      new ChatMistralAI({
        model: modelName,
        temperature: defaultTemperature,
        maxTokens: defaultMaxTokens,
        apiKey: apiToken || this.resolveApiKey(ModelProvider.MISTRAL),
        // Route through the same gateway as OpenAI/Anthropic.
        // Without serverURL, ChatMistralAI ignores FLUTCH_ROUTER_URL and calls
        // api.mistral.ai directly — inconsistent with other providers.
        serverURL: `${resolveRouterURL(baseURL)}/v1`,
      }),

    [ModelProvider.VOYAGEAI]: () => {
      throw new Error("VoyageAI chat models not implemented");
    },
  };

  // Rerank model creators
  private readonly rerankModelCreators: Record<
    ModelProvider,
    RerankModelCreator | undefined
  > = {
    [ModelProvider.COHERE]: ({ modelName, apiToken, maxDocuments, baseURL }) => {
      return new CohereRerank({
        model: modelName,
        topN: maxDocuments || 20,
        client: new CohereClient({
          token: apiToken || this.resolveApiKey(ModelProvider.COHERE),
          baseUrl: resolveRouterURL(baseURL),
        }),
      });
    },

    [ModelProvider.VOYAGEAI]: ({ modelName, apiToken, maxDocuments, baseURL }) => {
      return new VoyageAIRerank({
        apiKey: apiToken || this.resolveApiKey(ModelProvider.VOYAGEAI),
        model: modelName,
        topN: maxDocuments || 20,
        baseUrl: resolveRouterURL(baseURL),
      });
    },

    // Other providers don't support rerank yet
    [ModelProvider.OPENAI]: undefined,
    [ModelProvider.ANTHROPIC]: undefined,
    [ModelProvider.MISTRAL]: undefined,
    [ModelProvider.AWS]: undefined,
  };

  // Embedding model creators
  private readonly embeddingModelCreators: Record<
    ModelProvider,
    EmbeddingModelCreator | undefined
  > = {
    [ModelProvider.OPENAI]: ({ modelName, apiToken, baseURL }) =>
      new OpenAIEmbeddings({
        model: modelName,
        apiKey: apiToken || this.resolveApiKey(ModelProvider.OPENAI),
        configuration: { baseURL: `${resolveRouterURL(baseURL)}/v1` },
      }),

    // Other providers not yet implemented for embeddings
    [ModelProvider.ANTHROPIC]: undefined,
    [ModelProvider.COHERE]: undefined,
    [ModelProvider.MISTRAL]: undefined,
    [ModelProvider.AWS]: undefined,
    [ModelProvider.VOYAGEAI]: undefined,
  };

  // ══════════════════════════════════════════════════════════════
  //  initializeChatModel — overloaded: ModelConfig | ModelByIdConfig
  // ══════════════════════════════════════════════════════════════

  async initializeChatModel(
    config: ModelConfig | ModelByIdConfig,
    customTools?: DynamicStructuredTool[]
  ): Promise<ChatModelOrRunnable> {
    if ("provider" in config && "modelName" in config) {
      return this.initializeChatModelDirect(config as ModelConfig, customTools);
    }
    return this.initializeChatModelByIdInternal(config as ModelByIdConfig);
  }

  /**
   * Direct initialization by provider + modelName (no DB lookup).
   */
  private async initializeChatModelDirect(
    config: ModelConfig,
    customTools?: DynamicStructuredTool[]
  ): Promise<ChatModelOrRunnable> {
    const toolsConfig = normalizeToolConfigs(config.tools);
    const modelIdentifier = `${config.provider}:${config.modelName}`;
    const cacheKey = generateModelCacheKeyPure(
      modelIdentifier,
      config.temperature,
      config.maxTokens,
      toolsConfig,
      config.baseURL
    );

    const cached = this.modelInstanceCache.get(cacheKey);
    if (cached) {
      this.logger.debug(`Using cached chat model instance: ${cacheKey}`);
      return cached as ChatModelOrRunnable;
    }

    const provider = config.provider;
    if (!Object.values(ModelProvider).includes(provider)) {
      throw new Error(
        `Unknown provider "${provider}". Valid: ${Object.values(ModelProvider).join(", ")}`
      );
    }

    const apiToken = this.resolveApiKey(provider);
    const temperature = config.temperature ?? 0.7;
    const maxTokens = config.maxTokens ?? 4096;

    const modelConfig: ModelConfigWithTokenAndType = {
      modelId: modelIdentifier,
      modelName: config.modelName,
      provider,
      modelType: ModelType.CHAT,
      defaultTemperature: Number(temperature),
      defaultMaxTokens: Number(maxTokens),
      apiToken,
      requiresApiKey: true,
      baseURL: config.baseURL,
    };

    this.logger.debug(
      `Creating chat model: ${modelIdentifier} (apiKeyResolved=${!!apiToken})`
    );

    const creator = this.chatModelCreators[provider];
    if (!creator) {
      throw new Error(`Chat models not supported for provider: ${provider}`);
    }

    const model = creator(modelConfig);

    model.metadata = {
      ...model.metadata,
      modelId: modelIdentifier,
    };

    if (toolsConfig || customTools) {
      const boundModel = await this.bindToolsToModel(
        model,
        toolsConfig,
        customTools
      );
      this.modelInstanceCache.set(cacheKey, boundModel);
      return boundModel;
    }

    this.modelInstanceCache.set(cacheKey, model);
    return model;
  }

  /**
   * Legacy initialization by model ID (DB lookup via configFetcher).
   * @deprecated Pass ModelConfig with provider + modelName instead.
   */
  private async initializeChatModelByIdInternal(
    config: ModelByIdConfig
  ): Promise<ChatModelOrRunnable> {
    const cacheKey = this.generateModelCacheKey(config);

    const cachedModel = this.modelInstanceCache.get(cacheKey);
    if (cachedModel) {
      this.logger.debug(`Using cached chat model instance: ${cacheKey}`);
      return cachedModel as ChatModelOrRunnable;
    }

    const modelConfig = await this.getModelConfigWithType(config.modelId);

    if (modelConfig.modelType !== ModelType.CHAT) {
      throw new Error(
        `Model ${config.modelId} is not a chat model (type: ${modelConfig.modelType})`
      );
    }

    const finalConfig: ModelConfigWithTokenAndType = {
      ...modelConfig,
      defaultTemperature: Number(
        config.temperature ?? modelConfig.defaultTemperature
      ),
      defaultMaxTokens: Number(
        config.maxTokens ?? modelConfig.defaultMaxTokens
      ),
      baseURL: config.baseURL ?? modelConfig.baseURL,
    };

    this.logger.debug(`Creating new chat model instance: ${cacheKey}`);

    let model: BaseChatModel;
    if (finalConfig.useBedrock && finalConfig.bedrockModelId) {
      model = new ChatBedrockConverse({
        model: finalConfig.bedrockModelId,
        region: this.resolveBedrockRegion(),
        temperature: finalConfig.defaultTemperature,
        maxTokens: finalConfig.defaultMaxTokens,
        streaming: true,
      }) as unknown as BaseChatModel;
    } else {
      const creator = this.chatModelCreators[modelConfig.provider];
      if (!creator) {
        throw new Error(
          `Chat models not supported for provider: ${modelConfig.provider}`
        );
      }
      model = creator(finalConfig);
    }

    model.metadata = {
      ...model.metadata,
      modelId: config.modelId,
    };

    if (config.toolsConfig || config.customTools) {
      const boundModel = await this.bindToolsToModel(
        model,
        config.toolsConfig,
        config.customTools
      );
      this.modelInstanceCache.set(cacheKey, boundModel);
      return boundModel;
    }

    this.modelInstanceCache.set(cacheKey, model);
    return model;
  }

  /**
   * Bind tools to model (merge toolsConfig and customTools)
   * For toolsConfig: fetch tool executors from MCP Runtime
   * For customTools: use as-is (already prepared DynamicStructuredTool)
   *
   * Returns:
   * - Runnable when tools are bound (model.bindTools returns Runnable)
   * - BaseChatModel when no tools
   */
  private async bindToolsToModel(
    model: BaseChatModel,
    toolsConfig?: IAgentToolConfig[],
    customTools?: DynamicStructuredTool[]
  ): Promise<
    | BaseChatModel
    | Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions>
  > {
    const allTools: StructuredTool[] = [];

    // Process toolsConfig (fetch dynamic schemas from MCP Runtime)
    if (toolsConfig && toolsConfig.length > 0) {
      try {
        // Filter enabled tools
        const enabledToolsConfig = toolsConfig.filter(
          tc => tc.enabled !== false
        );

        if (enabledToolsConfig.length > 0) {
          this.logger.debug(
            `Fetching ${enabledToolsConfig.length} tools with dynamic schemas from MCP Runtime: ${enabledToolsConfig.map(tc => tc.toolName).join(", ")}`
          );

          // Use McpToolFilter to fetch tools with dynamic schemas
          const mcpToolFilter = new McpToolFilter();
          const mcpTools =
            await mcpToolFilter.getFilteredTools(enabledToolsConfig);

          this.logger.debug(
            `Successfully fetched ${mcpTools.length} tools with dynamic schemas from MCP Runtime`
          );

          allTools.push(...mcpTools);
        }
      } catch (error) {
        this.logger.error(
          `Failed to fetch tools from MCP Runtime: ${error instanceof Error ? error.message : String(error)}`
        );
        // Continue without MCP tools
      }
    }

    // Add custom tools (already prepared)
    if (customTools && customTools.length > 0) {
      allTools.push(...customTools);
      this.logger.debug(`Added ${customTools.length} custom tools to model`);
    }

    // Bind tools to model if we have any
    if (allTools.length > 0) {
      this.logger.debug(`Binding ${allTools.length} tools to model`);

      // bindTools returns Runnable, not BaseChatModel
      const modelWithTools = model.bindTools(allTools);
      return modelWithTools;
    }

    return model;
  }

  async initializeRerankModel(
    config: ModelByIdConfig
  ): Promise<BaseDocumentCompressor> {
    // Generate cache key for this rerank model configuration
    const cacheKey = this.generateModelCacheKey(config);

    // Check if we already have this exact model instance cached
    const cachedModel = this.modelInstanceCache.get(cacheKey);
    if (cachedModel) {
      this.logger.debug(`Using cached rerank model instance: ${cacheKey}`);
      return cachedModel as BaseDocumentCompressor;
    }

    const modelConfig = await this.getModelConfigWithType(config.modelId);

    if (modelConfig.modelType !== ModelType.RERANK) {
      throw new Error(
        `Model ${config.modelId} is not a rerank model (type: ${modelConfig.modelType})`
      );
    }

    const creator = this.rerankModelCreators[modelConfig.provider];
    if (!creator) {
      throw new Error(
        `Rerank models not supported for provider: ${modelConfig.provider}`
      );
    }

    this.logger.debug(`Creating new rerank model instance: ${cacheKey}`);
    const model = creator(modelConfig);

    // Attach modelId to model metadata - will automatically propagate to all events
    (model as any).metadata = {
      ...(model as any).metadata,
      modelId: config.modelId,
    };

    // Cache the created model instance
    this.modelInstanceCache.set(cacheKey, model);

    return model;
  }

  async initializeEmbeddingModel(config: ModelByIdConfig): Promise<Embeddings> {
    // Generate cache key for this embedding model configuration
    const cacheKey = this.generateModelCacheKey(config);

    // Check if we already have this exact model instance cached
    const cachedModel = this.modelInstanceCache.get(cacheKey);
    if (cachedModel) {
      this.logger.debug(`Using cached embedding model instance: ${cacheKey}`);
      return cachedModel as Embeddings;
    }

    const modelConfig = await this.getModelConfigWithType(config.modelId);

    if (modelConfig.modelType !== ModelType.EMBEDDING) {
      throw new Error(
        `Model ${config.modelId} is not an embedding model (type: ${modelConfig.modelType})`
      );
    }

    const creator = this.embeddingModelCreators[modelConfig.provider];
    if (!creator) {
      throw new Error(
        `Embedding models not supported for provider: ${modelConfig.provider}`
      );
    }

    this.logger.debug(`Creating new embedding model instance: ${cacheKey}`);
    const model = creator(modelConfig);

    // Attach modelId to model metadata - will automatically propagate to all events
    (model as any).metadata = {
      ...(model as any).metadata,
      modelId: config.modelId,
    };

    // Cache the created model instance
    this.modelInstanceCache.set(cacheKey, model);

    return model;
  }

  // === NEW TYPED METHODS ===

  async createChatModelById(modelId: string): Promise<ChatModelOrRunnable> {
    const config = await this.getModelConfigWithType(modelId);

    if (config.modelType !== ModelType.CHAT) {
      throw new Error(
        `Model ${modelId} is not a chat model, got: ${config.modelType}`
      );
    }

    return this.initializeChatModel(config);
  }

  async createRerankModelById(
    modelId: string
  ): Promise<BaseDocumentCompressor> {
    const config = await this.getModelConfigWithType(modelId);

    if (config.modelType !== ModelType.RERANK) {
      throw new Error(
        `Model ${modelId} is not a rerank model, got: ${config.modelType}`
      );
    }

    return this.initializeRerankModel(config);
  }

  async createEmbeddingModelById(modelId: string): Promise<Embeddings> {
    const config = await this.getModelConfigWithType(modelId);

    if (config.modelType !== ModelType.EMBEDDING) {
      throw new Error(
        `Model ${modelId} is not an embedding model, got: ${config.modelType}`
      );
    }

    return this.initializeEmbeddingModel(config);
  }

  async createModelById(
    modelId: string,
    expectedType?: ModelType
  ): Promise<Model> {
    const config = await this.getModelConfigWithType(modelId);

    // Check if it matches the expected type
    if (expectedType && config.modelType !== expectedType) {
      throw new Error(
        `Model ${modelId} expected to be ${expectedType}, but got: ${config.modelType}`
      );
    }

    return this.initializeModelByType(config);
  }

  // === LEGACY METHODS ===

  async initializeModelByType(config: ModelByIdWithTypeConfig): Promise<Model> {
    switch (config.modelType) {
      case ModelType.CHAT:
        return this.initializeChatModel(config);

      case ModelType.RERANK:
        return this.initializeRerankModel(config);

      case ModelType.EMBEDDING:
        return this.initializeEmbeddingModel(config);

      case ModelType.IMAGE:
      case ModelType.SPEECH:
        throw new Error(`Model type ${config.modelType} not yet supported`);

      default:
        throw new Error(`Unknown model type: ${config.modelType}`);
    }
  }

  async getModelConfigWithType(
    modelId: string
  ): Promise<ModelConfigWithTokenAndType> {
    // Check if we already have this model config cached
    const cachedConfig = this.modelConfigCache.get(modelId);
    if (cachedConfig) {
      this.logger.debug(`Using cached model config: ${modelId}`);
      return cachedConfig;
    }

    this.logger.debug(`Fetching model config: ${modelId}`);

    // Get base configuration
    const baseConfig = this.configFetcher
      ? await this.configFetcher(modelId)
      : await this.fetchFromApi(modelId);

    // Model config loaded successfully

    // Extend with model type and additional fields
    const result = {
      ...baseConfig,
      modelType: (baseConfig as any).modelType || ModelType.CHAT, // Fallback for legacy models
      maxDocuments: (baseConfig as any).maxDocuments,
      dimensions: (baseConfig as any).dimensions,
      supportedFormats: (baseConfig as any).supportedFormats,
    };

    // Model type resolved

    // Cache the result to avoid repeated API calls
    this.modelConfigCache.set(modelId, result);

    return result;
  }

  isModelTypeSupported(modelType: ModelType): boolean {
    return [ModelType.CHAT, ModelType.RERANK, ModelType.EMBEDDING].includes(
      modelType
    );
  }

  getSupportedModelTypes(): ModelType[] {
    return [ModelType.CHAT, ModelType.RERANK, ModelType.EMBEDDING];
  }

  /**
   * Clear all cached model configurations and instances
   */
  clearCache(): void {
    this.logger.debug(
      `Clearing ModelInitializer cache: ${this.modelConfigCache.size} configs, ${this.modelInstanceCache.size} instances`
    );
    this.modelConfigCache.clear();
    this.modelInstanceCache.clear();
  }

  /**
   * Clear cached data for a specific model ID
   */
  clearModelCache(modelId: string): void {
    this.modelConfigCache.delete(modelId);

    // Clear all instances that use this model ID
    const keysToDelete: string[] = [];
    for (const [key] of this.modelInstanceCache.entries()) {
      if (key.startsWith(`${modelId}:`)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => {
      this.modelInstanceCache.delete(key);
    });

    this.logger.debug(
      `Cleared cache for model ${modelId}: ${keysToDelete.length} instances`
    );
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    return {
      configCacheSize: this.modelConfigCache.size,
      instanceCacheSize: this.modelInstanceCache.size,
      configCacheKeys: Array.from(this.modelConfigCache.keys()),
      instanceCacheKeys: Array.from(this.modelInstanceCache.keys()),
    };
  }

  // Simple API request for microservices (copy from original LLMInitializer)
  private async fetchFromApi(
    modelId: string
  ): Promise<ModelConfigWithTokenAndType> {
    const apiUrl = process.env.API_URL;
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

    const config = await response.json();

    console.debug(
      `ModelInitializer.fetchFromApi - API response for ${modelId}:`,
      {
        url,
        statusCode: response.status,
        configKeys: Object.keys(config),
        modelType: config.modelType,
        hasModelType: !!config.modelType,
        fullConfig: config,
      }
    );

    // Extend configuration with model type
    const result = {
      ...config,
      modelType: config.modelType || ModelType.CHAT, // Fallback for compatibility
    };

    console.debug(`ModelInitializer.fetchFromApi - final result:`, {
      modelId,
      resultModelType: result.modelType,
      usedFallback: !config.modelType,
      resultKeys: Object.keys(result),
    });

    return result;
  }
}
