/**
 * Tests for Bedrock prompt caching (Converse `cachePoint`).
 *
 * The zetap console assistant re-sends the same ~29.6k-token prefix (65 tool
 * schemas + system prompt) on EVERY LLM call of every turn, because nothing
 * ever asked Bedrock to cache it. `ChatBedrockConverse` turns a `cache_control`
 * call option into cache points after the tools, the system prompt and the last
 * message, so the fix is to bind that option alongside the tools.
 *
 * What these tests pin down:
 *
 *   a) Bedrock + a supporting Claude model → `cache_control` bound with the
 *      tools, default TTL 5m, TTL overridable
 *   b) every other provider → call options byte-identical to before
 *   c) `promptCache: false` and unrecognised models → no cache points, because
 *      a model that does not support them rejects the whole request
 *   d) the override participates in the model instance cache key
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
    bindTools: jest.fn().mockReturnValue({ _type: "BoundModel", metadata: {} }),
  })),
}));

jest.mock("@langchain/anthropic", () => ({
  ChatAnthropic: jest.fn().mockImplementation((config: object) => ({
    ...config,
    _type: "ChatAnthropic",
    metadata: {},
    bindTools: jest.fn().mockReturnValue({ _type: "BoundModel", metadata: {} }),
  })),
}));

jest.mock("@langchain/openai", () => ({
  ChatOpenAI: jest.fn().mockImplementation((config: object) => ({
    ...config,
    _type: "ChatOpenAI",
    metadata: {},
    bindTools: jest.fn().mockReturnValue({ _type: "BoundModel", metadata: {} }),
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
    // One tool is enough — binding only happens when the list is non-empty.
    getFilteredTools: jest.fn().mockResolvedValue([{ name: "list_sites" }]),
  })),
}));

import { ChatBedrockConverse } from "@langchain/aws";
import { ChatOpenAI } from "@langchain/openai";
import { ModelInitializer } from "../models/model.initializer";
import { ModelProvider, ModelType } from "../models/enums";
import { ModelConfigWithTokenAndType } from "../models/model.interface";
import {
  buildEffortRequestFields,
  modelSupportsPromptCache,
  resolvePromptCacheControl,
} from "../models/model.logic";

const bedrockMock = ChatBedrockConverse as unknown as jest.Mock;
const openaiMock = ChatOpenAI as unknown as jest.Mock;

/** Last config object a mocked provider constructor was called with. */
function lastCallConfig(mock: jest.Mock): Record<string, unknown> {
  expect(mock).toHaveBeenCalled();
  return mock.mock.calls[mock.mock.calls.length - 1][0];
}

/** The `bindTools` spy of the last provider instance that was constructed. */
function lastBindTools(mock: jest.Mock): jest.Mock {
  expect(mock).toHaveBeenCalled();
  const instance = mock.mock.results[mock.mock.results.length - 1].value;
  return instance.bindTools as jest.Mock;
}

function makeBedrockConfig(
  overrides?: Partial<ModelConfigWithTokenAndType>
): ModelConfigWithTokenAndType {
  return {
    modelId: "model-bedrock",
    modelName: "claude-opus-5",
    provider: ModelProvider.ANTHROPIC,
    modelType: ModelType.CHAT,
    defaultMaxTokens: 8192,
    requiresApiKey: true,
    useBedrock: true,
    bedrockModelId: "us.anthropic.claude-opus-5",
    ...overrides,
  };
}

const TOOLS = [{ toolName: "list_sites", enabled: true }];

describe("modelSupportsPromptCache", () => {
  it.each([
    "us.anthropic.claude-opus-5",
    "anthropic.claude-opus-5",
    "us.anthropic.claude-opus-4-8",
    "us.anthropic.claude-sonnet-5",
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "claude-opus-4-20250514",
  ])("supports %s", id => {
    expect(modelSupportsPromptCache(id)).toBe(true);
  });

  it.each([
    // Legacy naming puts the version before the family — deliberately unmatched.
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "anthropic.claude-3-haiku-20240307-v1:0",
    // Haiku only supports cache points from 4.5 on.
    "anthropic.claude-haiku-4-0",
    // Not a Claude model at all.
    "deepseek.v3-2",
    "amazon.nova-pro-v1:0",
    undefined,
  ])("does not support %s", id => {
    expect(modelSupportsPromptCache(id)).toBe(false);
  });
});

describe("resolvePromptCacheControl", () => {
  it("defaults to a 5-minute TTL for a supported model", () => {
    expect(
      resolvePromptCacheControl(["us.anthropic.claude-opus-5", "claude-opus-5"])
    ).toEqual({ ttl: "5m" });
  });

  it("honours an explicit TTL", () => {
    expect(
      resolvePromptCacheControl(["us.anthropic.claude-opus-5"], undefined, "1h")
    ).toEqual({ ttl: "1h" });
  });

  it("enables caching when ANY identifier is a supported model", () => {
    expect(
      resolvePromptCacheControl(["some-internal-alias", "claude-opus-5"])
    ).toEqual({ ttl: "5m" });
  });

  it("returns undefined for an unsupported model", () => {
    expect(resolvePromptCacheControl(["amazon.nova-pro-v1:0"])).toBeUndefined();
  });

  it("lets the config force caching on for an unknown model", () => {
    expect(resolvePromptCacheControl(["future-model"], true)).toEqual({
      ttl: "5m",
    });
  });

  it("lets the config turn caching off for a supported model", () => {
    expect(
      resolvePromptCacheControl(["us.anthropic.claude-opus-5"], false)
    ).toBeUndefined();
  });
});

describe("prompt caching in ModelInitializer", () => {
  let initializer: ModelInitializer;
  let mockFetcher: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetcher = jest.fn();
    initializer = new ModelInitializer(mockFetcher);
  });

  it("binds cache_control with the tools for a supported Bedrock model", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig());

    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      toolsConfig: TOOLS,
    });

    const bindTools = lastBindTools(bedrockMock);
    expect(bindTools).toHaveBeenCalledTimes(1);
    const [tools, options] = bindTools.mock.calls[0];
    expect(tools).toEqual([{ name: "list_sites" }]);
    expect(options).toEqual({ cache_control: { ttl: "5m" } });
  });

  it("passes the catalog's TTL through", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig({ promptCacheTtl: "1h" }));

    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      toolsConfig: TOOLS,
    });

    const [, options] = lastBindTools(bedrockMock).mock.calls[0];
    expect(options).toEqual({ cache_control: { ttl: "1h" } });
  });

  it("lets the call override the catalog's TTL", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig({ promptCacheTtl: "1h" }));

    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      toolsConfig: TOOLS,
      promptCacheTtl: "5m",
    });

    const [, options] = lastBindTools(bedrockMock).mock.calls[0];
    expect(options).toEqual({ cache_control: { ttl: "5m" } });
  });

  it("binds no call options when the call disables caching", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig());

    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      toolsConfig: TOOLS,
      promptCache: false,
    });

    const bindTools = lastBindTools(bedrockMock);
    expect(bindTools.mock.calls[0]).toHaveLength(1);
  });

  it("binds no call options for a Bedrock model without cache support", async () => {
    mockFetcher.mockResolvedValue(
      makeBedrockConfig({
        modelName: "nova-pro",
        bedrockModelId: "amazon.nova-pro-v1:0",
      })
    );

    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      toolsConfig: TOOLS,
    });

    expect(lastBindTools(bedrockMock).mock.calls[0]).toHaveLength(1);
  });

  it("leaves non-Bedrock providers exactly as they were", async () => {
    mockFetcher.mockResolvedValue({
      modelId: "model-openai",
      modelName: "gpt-4o",
      provider: ModelProvider.OPENAI,
      modelType: ModelType.CHAT,
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
      requiresApiKey: true,
    });

    await initializer.initializeChatModel({
      modelId: "model-openai",
      toolsConfig: TOOLS,
    });

    expect(lastBindTools(openaiMock).mock.calls[0]).toHaveLength(1);
  });

  it("keeps instances with different cache settings apart in the cache", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig());

    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      toolsConfig: TOOLS,
    });
    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      toolsConfig: TOOLS,
      promptCache: false,
    });

    expect(bedrockMock).toHaveBeenCalledTimes(2);
  });

  it("reuses the cached instance for an unchanged config", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig());

    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      toolsConfig: TOOLS,
    });
    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      toolsConfig: TOOLS,
    });

    expect(bedrockMock).toHaveBeenCalledTimes(1);
  });
});

describe("buildEffortRequestFields", () => {
  it("wraps the level in output_config", () => {
    expect(buildEffortRequestFields("medium")).toEqual({
      output_config: { effort: "medium" },
    });
  });

  it("returns undefined when no effort is configured", () => {
    expect(buildEffortRequestFields()).toBeUndefined();
  });
});

describe("reasoning effort in ModelInitializer", () => {
  let initializer: ModelInitializer;
  let mockFetcher: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetcher = jest.fn();
    initializer = new ModelInitializer(mockFetcher);
  });

  it("omits additionalModelRequestFields entirely when no effort is set", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig());

    await initializer.initializeChatModel({ modelId: "model-bedrock" });

    expect(lastCallConfig(bedrockMock)).not.toHaveProperty(
      "additionalModelRequestFields"
    );
  });

  it("sends the catalog's default effort", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig({ defaultEffort: "low" }));

    await initializer.initializeChatModel({ modelId: "model-bedrock" });

    expect(lastCallConfig(bedrockMock).additionalModelRequestFields).toEqual({
      output_config: { effort: "low" },
    });
  });

  it("lets the call override the catalog's effort", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig({ defaultEffort: "low" }));

    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      effort: "xhigh",
    });

    expect(lastCallConfig(bedrockMock).additionalModelRequestFields).toEqual({
      output_config: { effort: "xhigh" },
    });
  });

  it("keeps instances with different efforts apart in the cache", async () => {
    mockFetcher.mockResolvedValue(makeBedrockConfig());

    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      effort: "low",
    });
    await initializer.initializeChatModel({
      modelId: "model-bedrock",
      effort: "high",
    });

    expect(bedrockMock).toHaveBeenCalledTimes(2);
  });
});
