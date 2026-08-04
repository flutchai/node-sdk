/**
 * Tests for sampling-parameter handling (temperature / topP / topK).
 *
 * Claude Opus 4.7+ and the Claude 5 generation removed sampling parameters
 * from the request surface — sending `temperature` makes Bedrock reject the
 * call with `ValidationException: ... \`temperature\` is deprecated for this
 * model.` These tests pin down three things:
 *
 *   a) new models  → constructed with NO sampling parameters
 *   b) old models  → temperature passed exactly as before (no regression)
 *   c) an explicitly requested temperature on a new model is ignored with a
 *      warning, and never breaks the request
 */

const mockLoggerSpies = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock("@nestjs/common", () => ({
  Logger: jest.fn().mockImplementation(() => mockLoggerSpies),
}));

jest.mock("@langchain/aws", () => ({
  ChatBedrockConverse: jest.fn().mockImplementation((config: object) => ({
    ...config,
    _type: "ChatBedrockConverse",
    metadata: {},
  })),
}));

jest.mock("@langchain/anthropic", () => ({
  ChatAnthropic: jest.fn().mockImplementation((config: object) => ({
    ...config,
    _type: "ChatAnthropic",
    metadata: {},
  })),
}));

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation((config: object) => ({
    ...config,
    _type: "ChatOpenAI",
    metadata: {},
  })),
  OpenAIEmbeddings: jest.fn(),
}));

jest.mock("@langchain/cohere", () => ({
  ChatCohere: jest.fn(),
  CohereRerank: jest.fn(),
}));

jest.mock("@langchain/mistralai", () => ({
  ChatMistralAI: jest.fn(),
}));

jest.mock("../models/rerankers/voyageai-rerank", () => ({
  VoyageAIRerank: jest.fn(),
}));

jest.mock("../tools/mcp-tool-filter", () => ({
  McpToolFilter: jest.fn().mockImplementation(() => ({
    getFilteredTools: jest.fn().mockResolvedValue([]),
  })),
}));

import { ChatBedrockConverse } from "@langchain/aws";
import { ChatAnthropic } from "@langchain/anthropic";
import { ModelInitializer } from "../models/model.initializer";
import { ModelProvider, ModelType } from "../models/enums";
import { ModelConfigWithTokenAndType } from "../models/model.interface";

const bedrockMock = ChatBedrockConverse as unknown as jest.Mock;
const anthropicMock = ChatAnthropic as unknown as jest.Mock;

/** Last config object a mocked provider constructor was called with. */
function lastCallConfig(mock: jest.Mock): Record<string, unknown> {
  expect(mock).toHaveBeenCalled();
  return mock.mock.calls[mock.mock.calls.length - 1][0];
}

function makeBedrockConfig(
  overrides?: Partial<ModelConfigWithTokenAndType>
): ModelConfigWithTokenAndType {
  return {
    modelId: "model-bedrock",
    modelName: "claude-sonnet-4-5",
    provider: ModelProvider.ANTHROPIC,
    modelType: ModelType.CHAT,
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    requiresApiKey: true,
    useBedrock: true,
    bedrockModelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    ...overrides,
  };
}

describe("sampling parameters", () => {
  let initializer: ModelInitializer;
  let mockFetcher: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetcher = jest.fn();
    initializer = new ModelInitializer(mockFetcher);
  });

  // ── (a) new models: no sampling parameters at all ──────────────────────
  describe("models without sampling-parameter support", () => {
    it("omits temperature for us.anthropic.claude-opus-4-7 on Bedrock", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({
          modelName: "claude-opus-4-7",
          bedrockModelId: "us.anthropic.claude-opus-4-7",
        })
      );

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      const config = lastCallConfig(bedrockMock);
      expect(config).not.toHaveProperty("temperature");
      // Everything else still flows through unchanged
      expect(config.model).toBe("us.anthropic.claude-opus-4-7");
      expect(config.maxTokens).toBe(4096);
      expect(config.streaming).toBe(true);
    });

    it.each([
      ["us.anthropic.claude-opus-4-8", "claude-opus-4-8"],
      ["us.anthropic.claude-opus-5", "claude-opus-5"],
      ["us.anthropic.claude-sonnet-5", "claude-sonnet-5"],
      ["eu.anthropic.claude-fable-5", "claude-fable-5"],
    ])("omits temperature for %s", async (bedrockModelId, modelName) => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({ modelName, bedrockModelId })
      );

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      expect(lastCallConfig(bedrockMock)).not.toHaveProperty("temperature");
    });

    it("detects a new model from the Bedrock id even when the catalog name is generic", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({
          modelName: "claude-opus-latest",
          bedrockModelId: "us.anthropic.claude-opus-5-20260401-v1:0",
        })
      );

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      expect(lastCallConfig(bedrockMock)).not.toHaveProperty("temperature");
    });

    it("omits temperature on the direct Anthropic path", async () => {
      const model = await initializer.initializeChatModel({
        provider: ModelProvider.ANTHROPIC,
        modelName: "claude-opus-5",
      });

      expect(lastCallConfig(anthropicMock)).not.toHaveProperty("temperature");
      expect((model as unknown as { _type: string })._type).toBe(
        "ChatAnthropic"
      );
    });
  });

  // ── (b) old models: unchanged behaviour ────────────────────────────────
  describe("models with sampling-parameter support (no regression)", () => {
    it("passes temperature for us.anthropic.claude-sonnet-4-5", async () => {
      mockFetcher.mockResolvedValue(makeBedrockConfig());

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      const config = lastCallConfig(bedrockMock);
      expect(config.temperature).toBe(0.7);
      expect(config.maxTokens).toBe(4096);
    });

    it.each([
      ["us.anthropic.claude-sonnet-4-6", "claude-sonnet-4-6"],
      ["us.anthropic.claude-opus-4-6", "claude-opus-4-6"],
      ["us.anthropic.claude-haiku-4-5", "claude-haiku-4-5"],
      ["us.anthropic.claude-3-5-haiku-20241022-v1:0", "claude-3-5-haiku"],
      ["anthropic.claude-opus-4-20250514-v1:0", "claude-opus-4"],
    ])("passes temperature for %s", async (bedrockModelId, modelName) => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({ modelName, bedrockModelId })
      );

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      expect(lastCallConfig(bedrockMock).temperature).toBe(0.7);
    });

    it("honours a per-call temperature override on an old model", async () => {
      mockFetcher.mockResolvedValue(makeBedrockConfig());

      await initializer.initializeChatModel({
        modelId: "model-bedrock",
        temperature: 0.2,
      });

      expect(lastCallConfig(bedrockMock).temperature).toBe(0.2);
    });

    it("passes temperature=0 rather than dropping it as falsy", async () => {
      mockFetcher.mockResolvedValue(makeBedrockConfig());

      await initializer.initializeChatModel({
        modelId: "model-bedrock",
        temperature: 0,
      });

      expect(lastCallConfig(bedrockMock).temperature).toBe(0);
    });

    it("passes temperature on the direct Anthropic path for claude-sonnet-4-5", async () => {
      await initializer.initializeChatModel({
        provider: ModelProvider.ANTHROPIC,
        modelName: "claude-sonnet-4-5",
        temperature: 0.3,
      });

      expect(lastCallConfig(anthropicMock).temperature).toBe(0.3);
    });

    it("keeps the direct-path default of 0.7 for old models", async () => {
      await initializer.initializeChatModel({
        provider: ModelProvider.ANTHROPIC,
        modelName: "claude-sonnet-4-6",
      });

      expect(lastCallConfig(anthropicMock).temperature).toBe(0.7);
    });
  });

  // ── (c) explicit temperature on a new model ────────────────────────────
  describe("explicit temperature on a model that rejects it", () => {
    it("ignores the value, warns, and still builds the model", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({
          modelName: "claude-opus-5",
          bedrockModelId: "us.anthropic.claude-opus-5",
        })
      );

      const model = await initializer.initializeChatModel({
        modelId: "model-bedrock",
        temperature: 0.9,
      });

      expect(model).toBeDefined();
      expect(lastCallConfig(bedrockMock)).not.toHaveProperty("temperature");
      expect(mockLoggerSpies.warn).toHaveBeenCalledWith(
        expect.stringContaining("does not accept sampling parameters")
      );
    });

    it("does not warn when only a catalog default was dropped", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({
          modelName: "claude-opus-5",
          bedrockModelId: "us.anthropic.claude-opus-5",
        })
      );

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      expect(mockLoggerSpies.warn).not.toHaveBeenCalled();
    });

    it("ignores an explicit temperature on the direct path too", async () => {
      const model = await initializer.initializeChatModel({
        provider: ModelProvider.ANTHROPIC,
        modelName: "claude-opus-5",
        temperature: 0.9,
      });

      expect(model).toBeDefined();
      expect(lastCallConfig(anthropicMock)).not.toHaveProperty("temperature");
      expect(mockLoggerSpies.warn).toHaveBeenCalled();
    });
  });

  // ── config-level override ──────────────────────────────────────────────
  describe("supportsSamplingParams override", () => {
    it("forces temperature through when set to true on the call", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({
          modelName: "claude-opus-5",
          bedrockModelId: "us.anthropic.claude-opus-5",
        })
      );

      await initializer.initializeChatModel({
        modelId: "model-bedrock",
        temperature: 0.4,
        supportsSamplingParams: true,
      });

      expect(lastCallConfig(bedrockMock).temperature).toBe(0.4);
    });

    it("forces temperature through when set to true in the model config", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({
          modelName: "claude-opus-5",
          bedrockModelId: "us.anthropic.claude-opus-5",
          supportsSamplingParams: true,
        })
      );

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      expect(lastCallConfig(bedrockMock).temperature).toBe(0.7);
    });

    it("suppresses temperature on an old model when set to false", async () => {
      mockFetcher.mockResolvedValue(makeBedrockConfig());

      await initializer.initializeChatModel({
        modelId: "model-bedrock",
        supportsSamplingParams: false,
      });

      expect(lastCallConfig(bedrockMock)).not.toHaveProperty("temperature");
    });

    it("does not share a cache entry across different override values", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({
          modelName: "claude-opus-5",
          bedrockModelId: "us.anthropic.claude-opus-5",
        })
      );

      const withoutOverride = await initializer.initializeChatModel({
        modelId: "model-bedrock",
      });
      const withOverride = await initializer.initializeChatModel({
        modelId: "model-bedrock",
        supportsSamplingParams: true,
      });

      expect(withoutOverride).not.toBe(withOverride);
    });
  });

  // ── NaN root cause ─────────────────────────────────────────────────────
  describe("missing temperature is absent, never NaN", () => {
    it("omits temperature when neither call nor catalog provides one", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({ defaultTemperature: undefined })
      );

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      const config = lastCallConfig(bedrockMock);
      expect(config).not.toHaveProperty("temperature");
      expect(config.temperature).not.toBeNaN();
    });

    it("omits maxTokens when neither call nor catalog provides one", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({ defaultMaxTokens: undefined })
      );

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      expect(lastCallConfig(bedrockMock).maxTokens).toBeUndefined();
    });

    it("does not turn a non-numeric temperature into NaN", async () => {
      mockFetcher.mockResolvedValue(
        makeBedrockConfig({
          defaultTemperature: "not-a-number" as unknown as number,
        })
      );

      await initializer.initializeChatModel({ modelId: "model-bedrock" });

      expect(lastCallConfig(bedrockMock)).not.toHaveProperty("temperature");
    });
  });
});
