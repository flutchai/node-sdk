/**
 * Tests for ModelInitializer
 *
 * Strategy: jest.mock all heavy LangChain/provider imports so we never
 * instantiate real LLM clients. We test the orchestration logic:
 * caching, provider routing, type validation, config fetching, GPT-5 patches.
 */

// Mock all LangChain provider modules BEFORE importing ModelInitializer
jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation((config: any) => ({
    ...config,
    _type: "ChatOpenAI",
    metadata: {},
    bindTools: jest.fn().mockReturnValue({ _type: "BoundModel", metadata: {} }),
  })),
  OpenAIEmbeddings: jest.fn().mockImplementation((config: any) => ({
    ...config,
    _type: "OpenAIEmbeddings",
    metadata: {},
  })),
}));

jest.mock("@langchain/anthropic", () => ({
  ChatAnthropic: jest.fn().mockImplementation((config: any) => ({
    ...config,
    _type: "ChatAnthropic",
    metadata: {},
  })),
}));

jest.mock("@langchain/cohere", () => ({
  ChatCohere: jest.fn().mockImplementation((config: any) => ({
    ...config,
    _type: "ChatCohere",
    metadata: {},
  })),
  CohereRerank: jest.fn().mockImplementation((config: any) => ({
    ...config,
    _type: "CohereRerank",
    metadata: {},
  })),
}));

jest.mock("@langchain/mistralai", () => ({
  ChatMistralAI: jest.fn().mockImplementation((config: any) => ({
    ...config,
    _type: "ChatMistralAI",
    metadata: {},
  })),
}));

jest.mock("../models/rerankers/voyageai-rerank", () => ({
  VoyageAIRerank: jest.fn().mockImplementation((config: any) => ({
    ...config,
    _type: "VoyageAIRerank",
    metadata: {},
  })),
}));

jest.mock("../tools/mcp-tool-filter", () => ({
  McpToolFilter: jest.fn().mockImplementation(() => ({
    getFilteredTools: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock("@nestjs/common", () => ({
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

import { ModelInitializer } from "../models/model.initializer";
import { ModelProvider, ModelType } from "../models/enums";
import { ModelConfigWithTokenAndType } from "../models/model.interface";

function makeChatConfig(
  overrides?: Partial<ModelConfigWithTokenAndType>
): ModelConfigWithTokenAndType {
  return {
    modelId: "model-123",
    modelName: "gpt-4o",
    provider: ModelProvider.OPENAI,
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    apiToken: "sk-test",
    requiresApiKey: true,
    modelType: ModelType.CHAT,
    ...overrides,
  };
}

function makeRerankConfig(
  overrides?: Partial<ModelConfigWithTokenAndType>
): ModelConfigWithTokenAndType {
  return {
    modelId: "rerank-1",
    modelName: "rerank-english-v3.0",
    provider: ModelProvider.COHERE,
    defaultTemperature: 0,
    defaultMaxTokens: 0,
    apiToken: "cohere-key",
    requiresApiKey: true,
    modelType: ModelType.RERANK,
    ...overrides,
  };
}

function makeEmbeddingConfig(
  overrides?: Partial<ModelConfigWithTokenAndType>
): ModelConfigWithTokenAndType {
  return {
    modelId: "embed-1",
    modelName: "text-embedding-3-small",
    provider: ModelProvider.OPENAI,
    defaultTemperature: 0,
    defaultMaxTokens: 0,
    apiToken: "sk-embed",
    requiresApiKey: true,
    modelType: ModelType.EMBEDDING,
    ...overrides,
  };
}

describe("ModelInitializer", () => {
  let initializer: ModelInitializer;
  let mockFetcher: jest.Mock;

  beforeEach(() => {
    mockFetcher = jest.fn();
    initializer = new ModelInitializer(mockFetcher);
  });

  describe("initializeChatModel", () => {
    it("should create OpenAI chat model", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      const model = await initializer.initializeChatModel({
        modelId: "model-123",
      });

      expect(model).toBeDefined();
      expect((model as any)._type).toBe("ChatOpenAI");
    });

    it("should create Anthropic chat model", async () => {
      mockFetcher.mockResolvedValue(
        makeChatConfig({
          provider: ModelProvider.ANTHROPIC,
          modelName: "claude-3-sonnet",
        })
      );

      const model = await initializer.initializeChatModel({
        modelId: "model-123",
      });

      expect((model as any)._type).toBe("ChatAnthropic");
    });

    it("should create Cohere chat model", async () => {
      mockFetcher.mockResolvedValue(
        makeChatConfig({
          provider: ModelProvider.COHERE,
          modelName: "command-r-plus",
        })
      );

      const model = await initializer.initializeChatModel({
        modelId: "model-123",
      });

      expect((model as any)._type).toBe("ChatCohere");
    });

    it("should create Mistral chat model", async () => {
      mockFetcher.mockResolvedValue(
        makeChatConfig({
          provider: ModelProvider.MISTRAL,
          modelName: "mistral-large",
        })
      );

      const model = await initializer.initializeChatModel({
        modelId: "model-123",
      });

      expect((model as any)._type).toBe("ChatMistralAI");
    });

    it("should throw for non-chat model type", async () => {
      mockFetcher.mockResolvedValue(
        makeChatConfig({ modelType: ModelType.RERANK })
      );

      await expect(
        initializer.initializeChatModel({ modelId: "model-123" })
      ).rejects.toThrow("is not a chat model");
    });

    it("should throw for unsupported provider", async () => {
      mockFetcher.mockResolvedValue(
        makeChatConfig({ provider: ModelProvider.VOYAGEAI })
      );

      await expect(
        initializer.initializeChatModel({ modelId: "model-123" })
      ).rejects.toThrow();
    });

    it("should override temperature and maxTokens from config", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      await initializer.initializeChatModel({
        modelId: "model-123",
        temperature: 0.2,
        maxTokens: 1024,
      });

      // The ChatOpenAI constructor was called with overridden values
      const { ChatOpenAI } = require("@langchain/openai");
      const lastCall =
        ChatOpenAI.mock.calls[ChatOpenAI.mock.calls.length - 1][0];
      expect(lastCall.temperature).toBe(0.2);
      expect(lastCall.maxTokens).toBe(1024);
    });

    it("should attach modelId to model metadata", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      const model = await initializer.initializeChatModel({
        modelId: "model-123",
      });

      expect((model as any).metadata.modelId).toBe("model-123");
    });
  });

  describe("initializeRerankModel", () => {
    it("should create Cohere rerank model", async () => {
      mockFetcher.mockResolvedValue(makeRerankConfig());

      const model = await initializer.initializeRerankModel({
        modelId: "rerank-1",
      });

      expect((model as any)._type).toBe("CohereRerank");
    });

    it("should create VoyageAI rerank model", async () => {
      mockFetcher.mockResolvedValue(
        makeRerankConfig({ provider: ModelProvider.VOYAGEAI })
      );

      const model = await initializer.initializeRerankModel({
        modelId: "rerank-1",
      });

      expect((model as any)._type).toBe("VoyageAIRerank");
    });

    it("should throw for non-rerank model type", async () => {
      mockFetcher.mockResolvedValue(
        makeRerankConfig({ modelType: ModelType.CHAT })
      );

      await expect(
        initializer.initializeRerankModel({ modelId: "rerank-1" })
      ).rejects.toThrow("is not a rerank model");
    });
  });

  describe("initializeEmbeddingModel", () => {
    it("should create OpenAI embedding model", async () => {
      mockFetcher.mockResolvedValue(makeEmbeddingConfig());

      const model = await initializer.initializeEmbeddingModel({
        modelId: "embed-1",
      });

      expect((model as any)._type).toBe("OpenAIEmbeddings");
    });

    it("should throw for non-embedding model type", async () => {
      mockFetcher.mockResolvedValue(
        makeEmbeddingConfig({ modelType: ModelType.CHAT })
      );

      await expect(
        initializer.initializeEmbeddingModel({ modelId: "embed-1" })
      ).rejects.toThrow("is not an embedding model");
    });
  });

  describe("caching", () => {
    it("should cache model config (fetcher called once for same modelId)", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      await initializer.initializeChatModel({ modelId: "model-123" });
      await initializer.initializeChatModel({ modelId: "model-123" });

      // Config fetched once, instance cached
      expect(mockFetcher).toHaveBeenCalledTimes(1);
    });

    it("should cache model instances (same config = same instance)", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      const m1 = await initializer.initializeChatModel({
        modelId: "model-123",
      });
      const m2 = await initializer.initializeChatModel({
        modelId: "model-123",
      });

      expect(m1).toBe(m2); // Same reference
    });

    it("should create different instances for different temperatures", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      const m1 = await initializer.initializeChatModel({
        modelId: "model-123",
        temperature: 0.5,
      });
      const m2 = await initializer.initializeChatModel({
        modelId: "model-123",
        temperature: 0.9,
      });

      expect(m1).not.toBe(m2);
    });

    it("clearCache should reset both config and instance caches", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      await initializer.initializeChatModel({ modelId: "model-123" });
      initializer.clearCache();

      await initializer.initializeChatModel({ modelId: "model-123" });
      expect(mockFetcher).toHaveBeenCalledTimes(2); // Fetched again after clear
    });

    it("clearModelCache should clear specific model", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      await initializer.initializeChatModel({ modelId: "model-123" });
      initializer.clearModelCache("model-123");

      await initializer.initializeChatModel({ modelId: "model-123" });
      expect(mockFetcher).toHaveBeenCalledTimes(2);
    });

    it("getCacheStats should return sizes and keys", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      await initializer.initializeChatModel({ modelId: "model-123" });

      const stats = initializer.getCacheStats();
      expect(stats.configCacheSize).toBe(1);
      expect(stats.instanceCacheSize).toBe(1);
      expect(stats.configCacheKeys).toContain("model-123");
    });
  });

  describe("initializeModelByType", () => {
    it("should route to chat model", async () => {
      const config = makeChatConfig();
      mockFetcher.mockResolvedValue(config);
      const model = await initializer.initializeModelByType(config);
      expect((model as any)._type).toBe("ChatOpenAI");
    });

    it("should route to rerank model", async () => {
      const config = makeRerankConfig();
      mockFetcher.mockResolvedValue(config);
      const model = await initializer.initializeModelByType(config);
      expect((model as any)._type).toBe("CohereRerank");
    });

    it("should route to embedding model", async () => {
      const config = makeEmbeddingConfig();
      mockFetcher.mockResolvedValue(config);
      const model = await initializer.initializeModelByType(config);
      expect((model as any)._type).toBe("OpenAIEmbeddings");
    });

    it("should throw for unsupported model types", async () => {
      await expect(
        initializer.initializeModelByType({
          ...makeChatConfig(),
          modelType: ModelType.IMAGE,
        })
      ).rejects.toThrow("not yet supported");
    });
  });

  describe("isModelTypeSupported / getSupportedModelTypes", () => {
    it("should support CHAT, RERANK, EMBEDDING", () => {
      expect(initializer.isModelTypeSupported(ModelType.CHAT)).toBe(true);
      expect(initializer.isModelTypeSupported(ModelType.RERANK)).toBe(true);
      expect(initializer.isModelTypeSupported(ModelType.EMBEDDING)).toBe(true);
    });

    it("should not support IMAGE, SPEECH", () => {
      expect(initializer.isModelTypeSupported(ModelType.IMAGE)).toBe(false);
      expect(initializer.isModelTypeSupported(ModelType.SPEECH)).toBe(false);
    });

    it("getSupportedModelTypes returns 3 types", () => {
      expect(initializer.getSupportedModelTypes()).toHaveLength(3);
    });
  });

  describe("createModelById", () => {
    it("should validate expected type", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      await expect(
        initializer.createModelById("model-123", ModelType.RERANK)
      ).rejects.toThrow("expected to be rerank");
    });

    it("should work when type matches", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      const model = await initializer.createModelById(
        "model-123",
        ModelType.CHAT
      );
      expect(model).toBeDefined();
    });
  });

  describe("GPT-5 model handling", () => {
    it("should use maxCompletionTokens for gpt-5 models", async () => {
      mockFetcher.mockResolvedValue(
        makeChatConfig({ modelName: "gpt-5-turbo" })
      );

      await initializer.initializeChatModel({ modelId: "model-123" });

      const { ChatOpenAI } = require("@langchain/openai");
      const lastCall =
        ChatOpenAI.mock.calls[ChatOpenAI.mock.calls.length - 1][0];
      expect(lastCall.maxCompletionTokens).toBe(4096);
      expect(lastCall.temperature).toBe(1); // forced to 1 for GPT-5
    });

    it("should use maxTokens for legacy gpt-4 models", async () => {
      mockFetcher.mockResolvedValue(
        makeChatConfig({ modelName: "gpt-4o-mini" })
      );

      await initializer.initializeChatModel({ modelId: "model-123" });

      const { ChatOpenAI } = require("@langchain/openai");
      const lastCall =
        ChatOpenAI.mock.calls[ChatOpenAI.mock.calls.length - 1][0];
      expect(lastCall.maxTokens).toBe(4096);
      expect(lastCall.temperature).toBe(0.7);
    });
  });

  describe("getModelConfigWithType", () => {
    it("should fetch and cache config", async () => {
      mockFetcher.mockResolvedValue(makeChatConfig());

      const c1 = await initializer.getModelConfigWithType("model-123");
      const c2 = await initializer.getModelConfigWithType("model-123");

      expect(c1).toEqual(c2);
      expect(mockFetcher).toHaveBeenCalledTimes(1);
    });

    it("should default modelType to CHAT if missing", async () => {
      mockFetcher.mockResolvedValue({
        modelId: "old-model",
        modelName: "gpt-3.5",
        provider: ModelProvider.OPENAI,
        defaultTemperature: 0.7,
        defaultMaxTokens: 2048,
        requiresApiKey: true,
        // no modelType field
      });

      const config = await initializer.getModelConfigWithType("old-model");
      expect(config.modelType).toBe(ModelType.CHAT);
    });
  });
});
