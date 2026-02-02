/**
 * Tests for AbstractGraphBuilder and UniversalGraphService
 *
 * Strategy: jest.mock heavy deps (fs, NestJS decorators, callback/endpoint modules).
 * We test: graphType generation, manifest loading, version validation,
 * config preparation, and UniversalGraphService routing.
 */

// Mock NestJS decorators and Logger
jest.mock("@nestjs/common", () => ({
  Injectable: () => (cls: any) => cls,
  Inject: () => () => {},
  Optional: () => () => {},
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock("@nestjs/config", () => ({
  ConfigService: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
  })),
}));

// Mock callback and endpoint modules
jest.mock("../callbacks", () => ({
  CallbackRegistry: jest.fn(),
}));

jest.mock("../agent-ui", () => ({
  EndpointRegistry: jest.fn().mockImplementation(() => ({
    register: jest.fn(),
    call: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    listGraphTypes: jest.fn().mockReturnValue([]),
  })),
  getEndpointMetadata: jest.fn().mockReturnValue([]),
  createEndpointDescriptors: jest.fn().mockReturnValue([]),
}));

// Mock fs for manifest loading
jest.mock("fs", () => ({
  readFileSync: jest.fn(),
}));

import {
  AbstractGraphBuilder,
  UniversalGraphService,
} from "../graph/abstract-graph.builder";
import * as fs from "fs";

// Concrete implementation for testing
class TestGraphBuilder extends AbstractGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  constructor() {
    // Prevent constructor from trying to load manifest or register callbacks
    (fs.readFileSync as jest.Mock).mockImplementation(() => {
      throw new Error("no manifest");
    });
    super();
  }

  async buildGraph(_config: any): Promise<any> {
    return { compiled: true };
  }
}

class TestGraphBuilderWithManifest extends AbstractGraphBuilder<"2.0.0"> {
  readonly version = "2.0.0" as const;

  constructor() {
    const manifest = {
      companySlug: "acme",
      name: "chatbot",
      title: "Acme Chatbot",
      description: "Test chatbot",
      detailedDescription: "A test chatbot for unit tests",
      versioning: {
        strategy: "semver",
        defaultVersion: "2.0.0",
        supportedVersions: ["2.0.0"],
      },
      versions: {
        "2.0.0": {
          status: "active",
          releaseDate: "2026-01-01",
          isActive: true,
          visibility: "public" as const,
        },
      },
    };

    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(manifest));
    super();
  }

  async buildGraph(_config: any): Promise<any> {
    return { compiled: true };
  }
}

describe("AbstractGraphBuilder", () => {
  // Clear timers so setImmediate callbacks don't interfere
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("graphType", () => {
    it('should return "unknown::{version}" when no manifest', () => {
      const builder = new TestGraphBuilder();
      expect(builder.graphType).toBe("unknown::1.0.0");
    });

    it("should return companySlug.name::version when manifest loaded", () => {
      const builder = new TestGraphBuilderWithManifest();
      expect(builder.graphType).toBe("acme.chatbot::2.0.0");
    });
  });

  describe("version", () => {
    it("should expose the version", () => {
      const builder = new TestGraphBuilder();
      expect(builder.version).toBe("1.0.0");
    });
  });

  describe("validateVersion", () => {
    it("should accept valid semver", () => {
      const builder = new TestGraphBuilder();
      expect(builder.validateVersion()).toBe(true);
    });

    it("should throw on invalid version format", () => {
      const builder = new TestGraphBuilder();
      // Override version for testing
      Object.defineProperty(builder, "version", { value: "v1.0" });
      expect(() => builder.validateVersion()).toThrow("Invalid version format");
    });
  });

  describe("getFullGraphType", () => {
    it("should combine baseGraphType with version", () => {
      const builder = new TestGraphBuilder();
      expect(builder.getFullGraphType("my-company.my-graph")).toBe(
        "my-company.my-graph::1.0.0"
      );
    });

    it("should throw when baseGraphType is empty", () => {
      const builder = new TestGraphBuilder();
      expect(() => builder.getFullGraphType("")).toThrow(
        "baseGraphType is required"
      );
    });
  });

  describe("preparePayload", () => {
    it("should merge payload.config with input", async () => {
      const builder = new TestGraphBuilderWithManifest();
      const payload = {
        threadId: "t-1",
        userId: "u-1",
        agentId: "a-1",
        requestId: "r-1",
        graphType: "acme.chatbot::2.0.0",
        input: { messages: [{ content: "hello" }] },
        config: {
          configurable: {
            thread_id: "t-1",
            context: {
              threadId: "t-1",
              userId: "u-1",
              agentId: "a-1",
            },
            graphSettings: { modelId: "gpt-4" },
          },
        },
      };

      const result = await builder.preparePayload(payload);

      expect(result.config.configurable.thread_id).toBe("t-1");
      expect(result.config.configurable.graphSettings.modelId).toBe("gpt-4");
      expect(result.input).toEqual({ messages: [{ content: "hello" }] });
    });

    it("should preserve config from payload", async () => {
      const builder = new TestGraphBuilderWithManifest();
      const payload = {
        threadId: "t-1",
        userId: "u-1",
        agentId: "a-1",
        requestId: "r-1",
        graphType: "acme.chatbot::2.0.0",
        input: undefined,
        config: {
          configurable: {
            thread_id: "t-1",
            context: {
              threadId: "t-1",
              userId: "u-1",
              agentId: "a-1",
            },
            checkpoint_ns: "acme.chatbot::2.0.0",
            checkpoint_id: "t-1-123",
            graphSettings: { modelId: "gpt-4" },
          },
        },
      };

      const result = await builder.preparePayload(payload);

      expect(result.config.configurable.checkpoint_ns).toBe(
        "acme.chatbot::2.0.0"
      );
      expect(result.config.configurable.checkpoint_id).toBe("t-1-123");
      expect(result.config.configurable.graphSettings.modelId).toBe("gpt-4");
    });

    it("should set input when provided in payload", async () => {
      const builder = new TestGraphBuilderWithManifest();
      const inputData = { messages: [{ content: "hello" }] };
      const payload = {
        threadId: "t-1",
        userId: "u-1",
        agentId: "a-1",
        requestId: "r-1",
        graphType: "acme.chatbot::2.0.0",
        input: inputData,
        config: {
          configurable: {
            thread_id: "t-1",
            context: {
              threadId: "t-1",
              userId: "u-1",
              agentId: "a-1",
            },
          },
        },
      };

      const config = await builder.preparePayload(payload);

      expect(config.input).toEqual(inputData);
    });
  });

  describe("customizeConfig", () => {
    it("should be called during prepareConfig and can modify config", async () => {
      class CustomBuilder extends TestGraphBuilderWithManifest {
        protected async customizeConfig(payload: any): Promise<any> {
          return {
            ...payload,
            config: {
              ...payload.config,
              configurable: {
                ...payload.config.configurable,
                customField: "custom-value",
              },
            },
          };
        }
      }

      const builder = new CustomBuilder();
      const payload = {
        threadId: "t-1",
        userId: "u-1",
        agentId: "a-1",
        requestId: "r-1",
        graphType: "acme.chatbot::2.0.0",
        input: undefined,
        config: {
          configurable: {
            thread_id: "t-1",
            context: {
              threadId: "t-1",
              userId: "u-1",
              agentId: "a-1",
            },
          },
        },
      };

      const result = await builder.preparePayload(payload);

      expect(result.config.configurable.customField).toBe("custom-value");
    });
  });

  describe("preparePayload - input deserialization", () => {
    it("should deserialize LangChain-serialized input (lc format)", async () => {
      const builder = new TestGraphBuilderWithManifest();
      // Simulate a serialized LangChain message with lc property
      const serializedInput = {
        lc: 1,
        type: "constructor",
        id: ["langchain_core", "messages", "HumanMessage"],
        kwargs: { content: "hello" },
      };

      const payload = {
        threadId: "t-1",
        userId: "u-1",
        agentId: "a-1",
        requestId: "r-1",
        graphType: "acme.chatbot::2.0.0",
        input: serializedInput as any,
        config: {
          configurable: {
            thread_id: "t-1",
            context: {
              threadId: "t-1",
              userId: "u-1",
              agentId: "a-1",
            },
          },
        },
      };

      const config = await builder.preparePayload(payload);

      // Should have input deserialized
      expect(config.input).toBeDefined();
    });

    it("should keep non-lc input as-is", async () => {
      const builder = new TestGraphBuilderWithManifest();
      const plainInput = { messages: [{ content: "plain", role: "user" }] };

      const payload = {
        threadId: "t-1",
        userId: "u-1",
        agentId: "a-1",
        requestId: "r-1",
        graphType: "acme.chatbot::2.0.0",
        input: plainInput as any,
        config: {
          configurable: {
            thread_id: "t-1",
            context: {
              threadId: "t-1",
              userId: "u-1",
              agentId: "a-1",
            },
          },
        },
      };

      const config = await builder.preparePayload(payload);

      expect(config.input).toEqual(plainInput);
    });

    it("should handle undefined input", async () => {
      const builder = new TestGraphBuilderWithManifest();
      const payload = {
        threadId: "t-1",
        userId: "u-1",
        agentId: "a-1",
        requestId: "r-1",
        graphType: "acme.chatbot::2.0.0",
        input: undefined,
        config: {
          configurable: {
            thread_id: "t-1",
            context: {
              threadId: "t-1",
              userId: "u-1",
              agentId: "a-1",
            },
          },
        },
      };

      const config = await builder.preparePayload(payload);

      expect(config.input).toBeUndefined();
    });
  });

  describe("getGraphMetadata", () => {
    it("should return manifest if already loaded", async () => {
      const builder = new TestGraphBuilderWithManifest();
      const meta = await builder.getGraphMetadata();

      expect(meta).not.toBeNull();
      expect(meta!.companySlug).toBe("acme");
      expect(meta!.name).toBe("chatbot");
    });
  });

  describe("loadManifestSync", () => {
    it("should handle missing manifest gracefully", () => {
      // TestGraphBuilder already handles this (throws in readFileSync)
      const builder = new TestGraphBuilder();
      expect(builder.graphType).toBe("unknown::1.0.0");
    });
  });
});

describe("UniversalGraphService", () => {
  let service: UniversalGraphService;
  let mockBuilder: any;
  let mockEngine: any;
  let mockEndpointRegistry: any;

  beforeEach(() => {
    jest.useFakeTimers();

    mockBuilder = {
      graphType: "test::1.0.0",
      buildGraph: jest.fn().mockResolvedValue({ compiled: true }),
      preparePayload: jest.fn().mockResolvedValue({
        configurable: { thread_id: "t-1" },
      }),
      constructor: { name: "TestBuilder" },
    };

    mockEngine = {
      invokeGraph: jest.fn().mockResolvedValue({
        text: "Hello",
        attachments: [],
        metadata: {},
        reasoningChains: [],
      }),
      streamGraph: jest.fn().mockResolvedValue({
        text: "Streamed",
        attachments: [],
        metadata: {},
        reasoningChains: [],
      }),
    };

    mockEndpointRegistry = {
      register: jest.fn(),
      call: jest.fn().mockResolvedValue({ data: {} }),
      list: jest.fn().mockReturnValue(["endpoint1"]),
      listGraphTypes: jest.fn().mockReturnValue(["test::1.0.0"]),
    };

    const mockConfigService = { get: jest.fn() };

    service = new UniversalGraphService(
      mockConfigService as any,
      [mockBuilder],
      mockEngine,
      mockEndpointRegistry
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("getSupportedGraphTypes", () => {
    it("should return graph types from builders", async () => {
      const types = await service.getSupportedGraphTypes();
      expect(types).toEqual(["test::1.0.0"]);
    });
  });

  describe("generateAnswer", () => {
    it("should build graph, prepare config, and invoke engine", async () => {
      const payload = {
        requestId: "r-1",
        graphType: "test::1.0.0",
        threadId: "t-1",
        userId: "u-1",
        agentId: "a-1",
        input: { messages: [] },
        config: {
          configurable: {
            thread_id: "t-1",
            context: {
              threadId: "t-1",
              userId: "u-1",
              agentId: "a-1",
            },
            graphSettings: {
              graphType: "test::1.0.0",
            },
          },
        },
      };

      const result = await service.generateAnswer(payload);

      expect(mockBuilder.buildGraph).toHaveBeenCalledWith(payload);
      expect(mockBuilder.preparePayload).toHaveBeenCalledWith(payload);
      expect(mockEngine.invokeGraph).toHaveBeenCalled();
      expect(result.requestId).toBe("r-1");
      expect(result.text).toBe("Hello");
    });

    it("should throw when no builder for graph type", async () => {
      const payload = {
        requestId: "r-1",
        graphType: "unknown::1.0.0",
        threadId: "t-1",
        userId: "u-1",
        agentId: "a-1",
        input: { messages: [] },
        config: {
          configurable: {
            thread_id: "t-1",
            context: {
              threadId: "t-1",
              userId: "u-1",
              agentId: "a-1",
            },
            graphSettings: {
              graphType: "unknown::1.0.0",
            },
          },
        },
      };

      await expect(service.generateAnswer(payload)).rejects.toThrow(
        "No builder found"
      );
    });
  });

  describe("healthCheck", () => {
    it("should return true when builders are registered", async () => {
      expect(await service.healthCheck()).toBe(true);
    });

    it("should return false when no builders", async () => {
      const emptyService = new UniversalGraphService(
        { get: jest.fn() } as any,
        [],
        mockEngine,
        mockEndpointRegistry
      );
      expect(await emptyService.healthCheck()).toBe(false);
    });
  });

  describe("cancelGeneration", () => {
    it("should cancel active generation without throwing", async () => {
      // Access private activeGenerations map via the service
      // Register a fake generation, then cancel it
      (service as any).activeGenerations.set("cancel-me", {
        cancel: jest.fn(),
      });

      await service.cancelGeneration("cancel-me");

      expect((service as any).activeGenerations.has("cancel-me")).toBe(false);
    });

    it("should handle cancelling non-existent generation", async () => {
      // Should not throw
      await service.cancelGeneration("non-existent");
    });
  });

  describe("endpoint operations", () => {
    it("listEndpoints should delegate to registry", () => {
      const endpoints = service.listEndpoints("test::1.0.0");
      expect(endpoints).toEqual(["endpoint1"]);
    });

    it("listGraphTypesWithEndpoints should delegate to registry", () => {
      const types = service.listGraphTypesWithEndpoints();
      expect(types).toEqual(["test::1.0.0"]);
    });

    it("callEndpoint should delegate to registry", async () => {
      await service.callEndpoint("test::1.0.0", "endpoint1", {
        userId: "u-1",
      } as any);

      expect(mockEndpointRegistry.call).toHaveBeenCalledWith(
        "test::1.0.0",
        "endpoint1",
        { userId: "u-1" }
      );
    });
  });
});
