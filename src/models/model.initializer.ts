import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { BaseDocumentCompressor } from "@langchain/core/retrievers/document_compressors";
import { Embeddings } from "@langchain/core/embeddings";
import { ChatOpenAI } from "@langchain/openai";
import { AzureChatOpenAI } from "@langchain/azure-openai";
import { Logger } from "@nestjs/common";
import { StructuredTool } from "@langchain/core/tools";
import { Runnable } from "@langchain/core/runnables";
import { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessageChunk } from "@langchain/core/messages";
import { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";

// WORKAROUND: Temporary monkey patch for GPT-5 support in LangChain
// LangChain doesn't yet recognize GPT-5 as a reasoning model and has issues:
// 1. Uses max_tokens instead of max_completion_tokens
// 2. Doesn't set mandatory temperature = 1 for GPT-5 models
// TODO: Remove this patch after official GPT-5 support in LangChain
function patchChatOpenAIForGPT5() {
  const logger = new Logger("ModelInitializer.Patch");

  logger.warn(
    `TEMPORARY WORKAROUND: Applying monkey patch for GPT-5 support in LangChain. Fixes: max_tokens->max_completion_tokens, temperature->1. This patch will be removed once LangChain officially supports GPT-5 models.`
  );

  // Patch both ChatOpenAI and AzureChatOpenAI
  const prototypes = [
    ChatOpenAI.prototype as any,
    AzureChatOpenAI.prototype as any,
  ];

  prototypes.forEach((prototype, index) => {
    const modelName = index === 0 ? "ChatOpenAI" : "AzureChatOpenAI";
    logger.warn(`Patching ${modelName} for GPT-5 support`);

    // Patch the invocationParams method that prepares parameters for the API
    const originalInvocationParams = prototype.invocationParams;

    if (originalInvocationParams) {
      prototype.invocationParams = function (options: any) {
        const params = originalInvocationParams.call(this, options);

        // Note: GPT-5 patch applied - params will be converted

        // If this is a GPT-5 model, apply all necessary patches
        if (
          params.model &&
          (params.model.includes("gpt-5") ||
            /^gpt-(5|6|7|8|9)/.test(params.model))
        ) {
          // 1. Convert max_tokens to max_completion_tokens
          if (params.max_tokens !== undefined) {
            params.max_completion_tokens = params.max_tokens;
            delete params.max_tokens;
          }

          // Also check max_output_tokens (may be used in Responses API)
          if (
            params.max_output_tokens !== undefined &&
            !params.max_completion_tokens
          ) {
            params.max_completion_tokens = params.max_output_tokens;
            delete params.max_output_tokens;
          }

          // 2. Force set temperature = 1 for GPT-5 models
          // GPT-5 models only support temperature = 1 (default value)
          const originalTemperature = params.temperature;
          if (params.temperature !== undefined && params.temperature !== 1) {
            params.temperature = 1;
            logger.debug(
              `Fixed temperature for ${params.model}: ${originalTemperature} -> 1 (GPT-5 models only support temperature=1)`
            );
          }

          // Parameters converted for GPT-5 compatibility
        }

        // Add stream_options to get usage information from Azure OpenAI
        if (
          params.model &&
          (params.model.includes("gpt-5") ||
            /^gpt-(5|6|7|8|9)/.test(params.model))
        ) {
          // Enable usage tracking for streaming responses
          if (!params.stream_options) {
            params.stream_options = { include_usage: true };
            logger.warn(
              `[GPT-5 PATCH] Added stream_options.include_usage=true for ${params.model}`
            );
          } else if (params.stream_options.include_usage !== true) {
            params.stream_options.include_usage = true;
            logger.warn(
              `[GPT-5 PATCH] Updated stream_options.include_usage=true for ${params.model}`
            );
          }
        }

        return params;
      };

      logger.warn(
        `Successfully patched ${modelName}.invocationParams for GPT-5 support (TEMPORARY WORKAROUND)`
      );
    } else {
      logger.warn(
        `Could not find invocationParams method to patch in ${modelName}`
      );
    }

    // Additionally patch completionWithRetry for low-level interception
    const originalCompletionWithRetry = prototype.completionWithRetry;

    if (originalCompletionWithRetry) {
      prototype.completionWithRetry = async function (
        request: any,
        options?: any
      ) {
        // Check and fix parameters right before sending
        if (
          request?.model &&
          (request.model.includes("gpt-5") ||
            /^gpt-(5|6|7|8|9)/.test(request.model))
        ) {
          let hasChanges = false;

          // 1. Fix max_tokens
          if (request.max_tokens !== undefined) {
            request.max_completion_tokens = request.max_tokens;
            delete request.max_tokens;
            hasChanges = true;
          }

          // 2. Fix temperature
          if (request.temperature !== undefined && request.temperature !== 1) {
            const originalTemp = request.temperature;
            request.temperature = 1;
            logger.debug(
              `Fixed temperature in completionWithRetry for ${request.model}: ${originalTemp} -> 1`
            );
            hasChanges = true;
          }

          // 3. Add stream_options for usage tracking
          if (!request.stream_options) {
            request.stream_options = { include_usage: true };
            logger.debug(
              `Added stream_options.include_usage=true in completionWithRetry for ${request.model}`
            );
            hasChanges = true;
          } else if (request.stream_options.include_usage !== true) {
            request.stream_options.include_usage = true;
            logger.debug(
              `Updated stream_options.include_usage=true in completionWithRetry for ${request.model}`
            );
            hasChanges = true;
          }

          if (hasChanges) {
            logger.debug(
              `Fixed request params in completionWithRetry for ${request.model}`
            );
          }
        }

        const result = await originalCompletionWithRetry.call(
          this,
          request,
          options
        );

        // Log response for usage information debugging
        if (
          request?.model &&
          (request.model.includes("gpt-5") ||
            /^gpt-(5|6|7|8|9)/.test(request.model))
        ) {
          logger.warn(
            `[GPT-5 PATCH] Azure OpenAI Response for ${request.model}:`
          );
          logger.warn(`Response keys: ${Object.keys(result || {}).join(", ")}`);

          if (result?.usage) {
            logger.warn(
              `Usage found: ${JSON.stringify(result.usage, null, 2)}`
            );
          } else {
            logger.warn(`No usage found in response`);
          }

          if (result?.choices && result.choices[0]) {
            logger.warn(
              `First choice keys: ${Object.keys(result.choices[0]).join(", ")}`
            );
          }
        }

        return result;
      };

      logger.warn(
        `Successfully patched ${modelName}.completionWithRetry for GPT-5 support (TEMPORARY WORKAROUND)`
      );
    }

    // Additionally patch isReasoningModel for correct reasoning model detection
    const originalIsReasoningModel = prototype.isReasoningModel;

    if (originalIsReasoningModel) {
      prototype.isReasoningModel = function () {
        const model =
          this.modelName || this.model || (this as any).lc_kwargs?.modelName;

        // Correct logic for identifying reasoning models:
        // 1. o1, o2, o3, o4 series - these are reasoning models
        // 2. gpt-5+ - these are reasoning models
        const isReasoning =
          /^o\d/.test(model) ||
          model.includes("gpt-5") ||
          /^gpt-(6|7|8|9)/.test(model);

        const originalResult = originalIsReasoningModel.call(this);

        logger.warn(
          `[GPT-5 PATCH] isReasoningModel check for "${model}": patched=${isReasoning}, original=${originalResult}, modelName=${this.modelName}, model=${(this as any).model}, lc_kwargs=${JSON.stringify((this as any).lc_kwargs?.modelName)}`
        );

        return isReasoning;
      };

      logger.warn(
        `Successfully patched ${modelName}.isReasoningModel for GPT-5+ reasoning models (TEMPORARY WORKAROUND)`
      );
    } else {
      logger.warn(
        `Could not find isReasoningModel method to patch in ${modelName}`
      );
    }

    // Remove bindTools patch - let it work natively

    // Remove custom token counting patches - let LangChain handle it

    // Patch invoke method for response logging
    const originalInvoke = prototype.invoke;

    if (originalInvoke) {
      prototype.invoke = async function (...args: any[]) {
        const model =
          this.modelName || this.model || (this as any).lc_kwargs?.modelName;

        if (model && model.includes("gpt-5")) {
          logger.warn(`[GPT-5 PATCH] Starting invoke for ${model}`);

          // Log invocation parameters
          if (args[1]) {
            const config = args[1];
            logger.warn(
              `[GPT-5 PATCH] Invoke config keys: ${Object.keys(config || {}).join(", ")}`
            );
            if (config.tools) {
              logger.warn(
                `[GPT-5 PATCH] Tools in config: ${config.tools.length} tools`
              );
            }
          }

          // Log model state
          const boundTools =
            (this as any).bound ||
            (this as any).boundTools ||
            (this as any).tools;
          if (boundTools) {
            logger.warn(
              `[GPT-5 PATCH] Model has bound tools: ${Array.isArray(boundTools) ? boundTools.length : "yes"}`
            );
          } else {
            logger.warn(`[GPT-5 PATCH] Model has NO bound tools`);
          }
        }

        let result;
        try {
          result = await originalInvoke.apply(this, args);
        } catch (error) {
          if (model && model.includes("gpt-5")) {
            logger.error(
              `[GPT-5 PATCH] Azure OpenAI invoke failed for ${model}:`,
              {
                errorMessage:
                  error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined,
                errorType: error?.constructor?.name,
                args: args.length,
                hasConfig: !!args[1],
                configKeys: args[1] ? Object.keys(args[1] || {}) : [],
                tools: args[1]?.tools?.length || 0,
              }
            );
          }
          throw error;
        }

        if (model && model.includes("gpt-5")) {
          logger.warn(`[GPT-5 PATCH] Azure OpenAI invoke result for ${model}:`);
          logger.warn(`Result keys: ${Object.keys(result || {}).join(", ")}`);

          if (result?.usage_metadata || result?.usageMetadata) {
            const usage = result.usage_metadata || result.usageMetadata;
            logger.warn(
              `Usage metadata found: ${JSON.stringify(usage, null, 2)}`
            );
          }

          if (result?.response_metadata || result?.responseMetadata) {
            const responseMetadata =
              result.response_metadata || result.responseMetadata;
            logger.warn(
              `Response metadata found: ${JSON.stringify(responseMetadata, null, 2)}`
            );

            // Create usage_metadata from estimatedTokenUsage if not present
            if (
              !result.usage_metadata &&
              responseMetadata?.estimatedTokenUsage
            ) {
              const estimatedUsage = responseMetadata.estimatedTokenUsage;
              result.usage_metadata = {
                input_tokens: estimatedUsage.promptTokens || 0,
                output_tokens: estimatedUsage.completionTokens || 0,
                total_tokens: estimatedUsage.totalTokens || 0,
              };

              logger.warn(
                `[GPT-5 PATCH] Created usage_metadata from estimatedTokenUsage: ${JSON.stringify(result.usage_metadata, null, 2)}`
              );
            }
          }

          if (!result?.usage_metadata && !result?.usageMetadata) {
            logger.warn(`No usage_metadata found in invoke result`);
          }
        }

        return result;
      };

      logger.warn(
        `Successfully patched ${modelName}.invoke for GPT-5 response logging (TEMPORARY WORKAROUND)`
      );
    }
  });
}

// Apply patch on module load
patchChatOpenAIForGPT5();
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatCohere } from "@langchain/cohere";
import { CohereRerank } from "@langchain/cohere";
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
} from "./model.interface";
import { ModelByIdConfig, ModelConfigFetcher } from "./llm.types";

export class ModelInitializer implements IModelInitializer {
  private logger: Logger;

  // Cache for model configurations to avoid repeated API calls
  private modelConfigCache = new Map<string, ModelConfigWithTokenAndType>();

  // Cache for model instances to avoid recreating identical models
  private modelInstanceCache = new Map<string, Model>();

  constructor(
    private configFetcher?: ModelConfigFetcher,
    logger?: Logger
  ) {
    this.logger = logger || new Logger(ModelInitializer.name);
  }

  /**
   * Generate cache key for model instances based on configuration
   */
  private generateModelCacheKey(
    modelId: string,
    temperature?: number,
    maxTokens?: number,
    modelType?: ModelType
  ): string {
    return `${modelId}:${temperature || "default"}:${maxTokens || "default"}:${modelType || ModelType.CHAT}`;
  }

  /**
   * TEMPORARY SOLUTION for compatibility with new OpenAI models
   *
   * OpenAI changed the API for new models (gpt-5, o-series):
   * - Old models (gpt-3.5, gpt-4, gpt-4o): use maxTokens, support custom temperature
   * - New reasoning models (gpt-5, gpt-o1, gpt-o3, gpt-o4): use maxCompletionTokens, only temperature = 1
   *
   * Patch fixes:
   * 1. max_tokens -> max_completion_tokens for reasoning GPT-5+ models
   * 2. temperature -> 1 (forced) for reasoning GPT-5+ models
   *
   * @param modelName - OpenAI model name
   * @returns true if model requires maxCompletionTokens and temperature = 1
   */
  private requiresMaxCompletionTokens(modelName: string): boolean {
    const requiresNew =
      modelName.includes("gpt-5") ||
      modelName.includes("gpt-o1") ||
      modelName.includes("gpt-o2") ||
      modelName.includes("gpt-o3") ||
      modelName.includes("gpt-o4") ||
      // Add other patterns as new models are released
      /^gpt-(5|6|7|8|9)/.test(modelName) ||
      /^gpt-o[1-4]/.test(modelName);

    this.logger.debug(`Checking token parameter for model "${modelName}"`, {
      modelName,
      requiresMaxCompletionTokens: requiresNew,
      checks: {
        includesGpt5: modelName.includes("gpt-5"),
        includesO1: modelName.includes("gpt-o1"),
        includesO2: modelName.includes("gpt-o2"),
        includesO3: modelName.includes("gpt-o3"),
        includesO4: modelName.includes("gpt-o4"),
        regexGpt5Plus: /^gpt-(5|6|7|8|9)/.test(modelName),
        regexO1to4: /^gpt-o[1-4]/.test(modelName),
      },
    });

    return requiresNew;
  }

  // Chat model creators (inherit from original LLMInitializer)
  private readonly chatModelCreators: Partial<
    Record<ModelProvider, ChatModelCreator>
  > = {
    [ModelProvider.OPENAI]: ({
      modelName,
      defaultTemperature,
      defaultMaxTokens,
      apiToken,
    }) => {
      // HARDCODED: Create clean configuration depending on model type for regular OpenAI models
      if (this.requiresMaxCompletionTokens(modelName)) {
        // Configuration for new GPT-5+ models
        // GPT-5+ models only support temperature = 1
        const fixedTemperature = 1;
        const config = {
          modelName,
          temperature: fixedTemperature, // Force set to 1
          maxCompletionTokens: defaultMaxTokens, // Only this parameter for new models
          streaming: true,
          openAIApiKey: apiToken || process.env.OPENAI_API_KEY,
        };

        if (defaultTemperature !== 1) {
          this.logger.debug(
            `Fixed temperature for GPT-5+ model ${modelName}: ${defaultTemperature} -> 1 (GPT-5+ models only support temperature=1)`
          );
        }

        // Creating GPT-5+ model with fixed parameters

        const chatOpenAI = new ChatOpenAI(config);

        // ChatOpenAI instance created

        return chatOpenAI;
      } else {
        // Configuration for legacy GPT-3.5/GPT-4 models
        const config = {
          modelName,
          temperature: defaultTemperature,
          maxTokens: defaultMaxTokens, // Only this parameter for legacy models
          streaming: true,
          openAIApiKey: apiToken || process.env.OPENAI_API_KEY,
        };

        // Creating legacy OpenAI model

        const chatOpenAI = new ChatOpenAI(config);

        // Legacy ChatOpenAI instance created

        return chatOpenAI;
      }
    },

    [ModelProvider.ANTHROPIC]: ({
      modelName,
      defaultTemperature,
      defaultMaxTokens,
      apiToken,
    }) =>
      new ChatAnthropic({
        modelName,
        temperature: defaultTemperature,
        maxTokens: defaultMaxTokens,
        anthropicApiKey: apiToken || process.env.ANTHROPIC_API_KEY,
      }) as unknown as BaseChatModel,

    [ModelProvider.COHERE]: ({
      modelName,
      defaultTemperature,
      defaultMaxTokens,
      apiToken,
    }) =>
      new ChatCohere({
        model: modelName,
        temperature: defaultTemperature,
        // Cohere uses maxTokens via max_tokens parameter, but it's not supported in ChatCohere API
        apiKey: apiToken || process.env.COHERE_API_KEY,
      }),

    [ModelProvider.MISTRAL]: ({
      modelName,
      defaultTemperature,
      defaultMaxTokens,
      apiToken,
    }) =>
      new ChatMistralAI({
        model: modelName,
        temperature: defaultTemperature,
        maxTokens: defaultMaxTokens,
        apiKey: apiToken || process.env.MISTRAL_API_KEY,
      }),

    // AWS Bedrock support removed - use Anthropic or OpenAI directly instead

    [ModelProvider.FLUTCH_OPENAI]: ({
      modelName,
      defaultTemperature,
      defaultMaxTokens,
      apiToken,
    }) => {
      // HARDCODED: Create clean configuration depending on model type (same as for regular OpenAI)
      if (this.requiresMaxCompletionTokens(modelName)) {
        // Configuration for new GPT-5+ models
        // GPT-5+ models only support temperature = 1
        const fixedTemperature = 1;
        const config = {
          modelName,
          temperature: fixedTemperature, // Force set to 1
          maxCompletionTokens: defaultMaxTokens, // Only this parameter for new models
          streaming: true,
          openAIApiKey: apiToken || process.env.OPENAI_API_KEY,
        };

        if (defaultTemperature !== 1) {
          this.logger.debug(
            `Fixed temperature for FLUTCH GPT-5+ model ${modelName}: ${defaultTemperature} -> 1 (GPT-5+ models only support temperature=1)`
          );
        }

        this.logger.debug(`Creating FLUTCH GPT-5+ model with config`, {
          modelName,
          maxCompletionTokens: defaultMaxTokens,
          temperature: fixedTemperature,
          originalTemperature: defaultTemperature,
          hasApiKey: !!config.openAIApiKey,
        });

        const chatOpenAI = new ChatOpenAI(config);

        // Log initialized instance for debugging
        this.logger.debug(`FLUTCH ChatOpenAI GPT-5+ instance created`, {
          modelName: modelName, // Use modelName from parameters
          maxTokens: (chatOpenAI as any).maxTokens,
          maxCompletionTokens: (chatOpenAI as any).maxCompletionTokens,
          temperature: chatOpenAI.temperature,
          streaming: chatOpenAI.streaming,
          // Try to get internal parameters
          clientConfig: (chatOpenAI as any).clientConfig,
          kwargs: (chatOpenAI as any).kwargs,
        });

        return chatOpenAI;
      } else {
        // Configuration for legacy GPT-3.5/GPT-4 models
        const config = {
          modelName,
          temperature: defaultTemperature,
          maxTokens: defaultMaxTokens, // Only this parameter for legacy models
          streaming: true,
          openAIApiKey: apiToken || process.env.OPENAI_API_KEY,
        };

        this.logger.debug(`Creating FLUTCH legacy model with config`, {
          modelName,
          maxTokens: defaultMaxTokens,
          temperature: defaultTemperature,
          hasApiKey: !!config.openAIApiKey,
        });

        const chatOpenAI = new ChatOpenAI(config);

        // Log initialized instance for debugging
        this.logger.debug(`FLUTCH ChatOpenAI legacy instance created`, {
          modelName: modelName, // Use modelName from parameters
          maxTokens: (chatOpenAI as any).maxTokens,
          maxCompletionTokens: (chatOpenAI as any).maxCompletionTokens,
          temperature: chatOpenAI.temperature,
          streaming: chatOpenAI.streaming,
          // Try to get internal parameters
          clientConfig: (chatOpenAI as any).clientConfig,
          kwargs: (chatOpenAI as any).kwargs,
        });

        return chatOpenAI;
      }
    },

    // Other providers not yet implemented for chat
    [ModelProvider.FLUTCH]: () => {
      throw new Error("Flutch chat models not implemented");
    },
    [ModelProvider.FLUTCH_MISTRAL]: () => {
      throw new Error("Flutch Mistral chat models not implemented");
    },
    [ModelProvider.FLUTCH_ANTHROPIC]: () => {
      throw new Error("Flutch Anthropic chat models not implemented");
    },
    [ModelProvider.VOYAGEAI]: () => {
      throw new Error("VoyageAI chat models not implemented");
    },
  };

  // Rerank model creators
  private readonly rerankModelCreators: Record<
    ModelProvider,
    RerankModelCreator | undefined
  > = {
    [ModelProvider.COHERE]: ({ modelName, apiToken, maxDocuments }) => {
      return new CohereRerank({
        apiKey: apiToken || process.env.COHERE_API_KEY,
        model: modelName,
        topN: maxDocuments || 20,
      });
    },

    [ModelProvider.VOYAGEAI]: ({ modelName, apiToken, maxDocuments }) => {
      return new VoyageAIRerank({
        apiKey: apiToken || process.env.VOYAGEAI_API_KEY,
        model: modelName,
        topN: maxDocuments || 20,
      });
    },

    // Other providers don't support rerank yet
    [ModelProvider.OPENAI]: undefined,
    [ModelProvider.ANTHROPIC]: undefined,
    [ModelProvider.MISTRAL]: undefined,
    [ModelProvider.AWS]: undefined,
    [ModelProvider.FLUTCH]: undefined,
    [ModelProvider.FLUTCH_MISTRAL]: undefined,
    [ModelProvider.FLUTCH_OPENAI]: undefined,
    [ModelProvider.FLUTCH_ANTHROPIC]: undefined,
  };

  // Embedding model creators
  private readonly embeddingModelCreators: Record<
    ModelProvider,
    EmbeddingModelCreator | undefined
  > = {
    [ModelProvider.OPENAI]: ({ modelName, apiToken }) =>
      new OpenAIEmbeddings({
        model: modelName,
        apiKey: apiToken || process.env.OPENAI_API_KEY,
      }),

    // Other providers not yet implemented for embeddings
    [ModelProvider.ANTHROPIC]: undefined,
    [ModelProvider.COHERE]: undefined,
    [ModelProvider.MISTRAL]: undefined,
    [ModelProvider.AWS]: undefined,
    [ModelProvider.FLUTCH]: undefined,
    [ModelProvider.FLUTCH_MISTRAL]: undefined,
    [ModelProvider.FLUTCH_OPENAI]: undefined,
    [ModelProvider.FLUTCH_ANTHROPIC]: undefined,
    [ModelProvider.VOYAGEAI]: undefined,
  };

  async initializeChatModel(config: ModelByIdConfig): Promise<BaseChatModel> {
    // Generate cache key for this specific model configuration
    const cacheKey = this.generateModelCacheKey(
      config.modelId,
      config.temperature,
      config.maxTokens,
      ModelType.CHAT
    );

    // Check if we already have this exact model instance cached
    const cachedModel = this.modelInstanceCache.get(cacheKey);
    if (cachedModel) {
      this.logger.debug(`Using cached chat model instance: ${cacheKey}`);
      return cachedModel as BaseChatModel;
    }

    const modelConfig = await this.getModelConfigWithType(config.modelId);

    if (modelConfig.modelType !== ModelType.CHAT) {
      throw new Error(
        `Model ${config.modelId} is not a chat model (type: ${modelConfig.modelType})`
      );
    }

    const creator = this.chatModelCreators[modelConfig.provider];
    if (!creator) {
      throw new Error(
        `Chat models not supported for provider: ${modelConfig.provider}`
      );
    }

    // Override parameters from request
    const finalConfig: ModelConfigWithTokenAndType = {
      ...modelConfig,
      defaultTemperature: Number(
        config.temperature ?? modelConfig.defaultTemperature
      ),
      defaultMaxTokens: Number(
        config.maxTokens ?? modelConfig.defaultMaxTokens
      ),
    };

    this.logger.debug(`Creating new chat model instance: ${cacheKey}`);
    const model = creator(finalConfig);

    // Attach modelId to model metadata - will automatically propagate to all LangChain events
    model.metadata = {
      ...model.metadata,
      modelId: config.modelId,
    };

    this.logger.debug("🔧 Model initialized with metadata", {
      modelId: config.modelId,
      metadataKeys: Object.keys(model.metadata || {}),
      hasModelId: !!model.metadata?.modelId,
    });

    // Cache the created model instance
    this.modelInstanceCache.set(cacheKey, model);

    return model;
  }

  async initializeRerankModel(
    config: ModelByIdConfig
  ): Promise<BaseDocumentCompressor> {
    // Generate cache key for this rerank model configuration
    const cacheKey = this.generateModelCacheKey(
      config.modelId,
      undefined, // rerank models typically don't use temperature
      config.maxTokens,
      ModelType.RERANK
    );

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
    const cacheKey = this.generateModelCacheKey(
      config.modelId,
      undefined, // embedding models typically don't use temperature
      undefined, // embedding models typically don't use maxTokens
      ModelType.EMBEDDING
    );

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

  async createChatModelById(modelId: string): Promise<BaseChatModel> {
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

/**
 * Helper function for Azure OpenAI tools binding
 *
 * Azure OpenAI doesn't support bindTools method, so we need to:
 * 1. Check if model has bindTools (regular OpenAI models)
 * 2. If yes - use bindTools normally
 * 3. If no (Azure) - pass tools manually in config
 *
 * @param model - LangChain chat model instance
 * @param tools - Array of tools to bind/configure
 * @param baseConfig - Base configuration for invoke
 * @returns Object with prepared model and config for tools
 */
export function prepareModelWithTools(
  model: BaseChatModel,
  tools: StructuredTool[],
  baseConfig: any = {}
): {
  modelWithTools: any; // Can be BaseChatModel or result of bindTools
  finalConfig: any;
  toolsMethod: "bindTools" | "manual" | "none";
} {
  if (tools.length === 0) {
    return {
      modelWithTools: model,
      finalConfig: baseConfig,
      toolsMethod: "none",
    };
  }

  // Check if model supports bindTools (regular OpenAI models)
  if (model.bindTools && typeof model.bindTools === "function") {
    try {
      const modelWithTools = model.bindTools(tools);
      return {
        modelWithTools,
        finalConfig: baseConfig,
        toolsMethod: "bindTools",
      };
    } catch (error) {
      // Fallback to manual if bindTools fails
      const invokeConfig = { tools };
      const finalConfig = { ...baseConfig, ...invokeConfig };
      return {
        modelWithTools: model,
        finalConfig,
        toolsMethod: "manual",
      };
    }
  }

  // Azure OpenAI case - pass tools manually in config
  const invokeConfig = { tools };
  const finalConfig = { ...baseConfig, ...invokeConfig };

  return {
    modelWithTools: model,
    finalConfig,
    toolsMethod: "manual",
  };
}
