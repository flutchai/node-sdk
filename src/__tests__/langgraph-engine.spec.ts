import { LangGraphEngine } from "../engines/langgraph/langgraph-engine";
import {
  EventProcessor,
  StreamAccumulator,
} from "../engines/langgraph/event-processor.utils";
import { ConfigService } from "@nestjs/config";
import {
  storeAttachmentData,
  getAttachmentData,
  clearAttachmentDataStore,
} from "../graph/attachment-tool-node";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("LangGraphEngine", () => {
  let engine: LangGraphEngine;
  let mockEventProcessor: jest.Mocked<EventProcessor>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockAccumulator: StreamAccumulator;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock accumulator
    mockAccumulator = {
      channels: new Map(),
      attachments: [],
      metadata: {},
      traceEvents: [],
      traceStartedAt: Date.now(),
      traceCompletedAt: null,
    };

    // Create mock EventProcessor
    mockEventProcessor = {
      createAccumulator: jest.fn().mockReturnValue(mockAccumulator),
      processEvent: jest.fn(),
      getResult: jest.fn().mockReturnValue({
        content: {
          text: "Test response",
          contentChains: [],
          attachments: [],
          metadata: {},
        },
        trace: {
          events: [
            {
              type: "on_chat_model_end",
              nodeName: "test_node",
              timestamp: Date.now(),
              metadata: { usage: { prompt_tokens: 10, completion_tokens: 5 } },
            },
          ],
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 100,
          totalEvents: 1,
        },
      }),
    } as unknown as jest.Mocked<EventProcessor>;

    // Create mock ConfigService
    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === "API_URL") return "http://test-backend";
        if (key === "INTERNAL_API_TOKEN") return "test-token";
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    // Create engine instance
    engine = new LangGraphEngine(mockEventProcessor, mockConfigService);

    // Default mock fetch response
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stored: 1 }),
    });
  });

  describe("streamGraph", () => {
    it("should process events and return content on success", async () => {
      // Arrange
      const mockGraph = {
        streamEvents: jest.fn().mockImplementation(async function* () {
          yield {
            event: "on_chat_model_stream",
            data: { chunk: { content: "Hello" } },
          };
          yield { event: "on_chat_model_end", data: {} };
        }),
      };

      const config = {
        input: { messages: [{ content: "test" }] },
        configurable: {
          context: {
            messageId: "msg-123",
            threadId: "thread-123",
            userId: "user-123",
            agentId: "agent-123",
            companyId: "company-123",
          },
        },
      };

      const onPartial = jest.fn();

      // Act
      const result = await engine.streamGraph(mockGraph, config, onPartial);

      // Assert
      expect(mockEventProcessor.createAccumulator).toHaveBeenCalled();
      expect(mockEventProcessor.processEvent).toHaveBeenCalled();
      expect(mockEventProcessor.getResult).toHaveBeenCalledWith(
        mockAccumulator
      );
      expect(result).toEqual({
        text: "Test response",
        contentChains: [],
        attachments: [],
        metadata: {},
      });
    });

    it("should send trace webhook even when graph throws error", async () => {
      // Arrange
      const streamError = new Error("LLM API rate limit exceeded");
      const mockGraph = {
        streamEvents: jest.fn().mockImplementation(async function* () {
          yield {
            event: "on_chat_model_stream",
            data: { chunk: { content: "Partial" } },
          };
          throw streamError;
        }),
      };

      const config = {
        input: { messages: [{ content: "test" }] },
        configurable: {
          context: {
            messageId: "msg-123",
            threadId: "thread-123",
            userId: "user-123",
            agentId: "agent-123",
            companyId: "company-123",
          },
        },
      };

      const onPartial = jest.fn();

      // Act & Assert
      await expect(
        engine.streamGraph(mockGraph, config, onPartial)
      ).rejects.toThrow("LLM API rate limit exceeded");

      // Verify trace webhook was called with error status
      expect(mockFetch).toHaveBeenCalled();
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe(
        "http://test-backend/internal/usage/trace-events/batch"
      );

      const requestBody = JSON.parse(fetchCall[1].body);
      expect(requestBody.status).toBe("error");
      expect(requestBody.error).toEqual({
        message: "LLM API rate limit exceeded",
        name: "Error",
      });
      expect(requestBody.messageId).toBe("msg-123");
    });

    it("should capture events before error occurs", async () => {
      // Arrange
      const mockGraph = {
        streamEvents: jest.fn().mockImplementation(async function* () {
          yield { event: "on_chat_model_start", data: {} };
          yield {
            event: "on_chat_model_stream",
            data: { chunk: { content: "Before error" } },
          };
          throw new Error("Connection lost");
        }),
      };

      const config = {
        input: { messages: [{ content: "test" }] },
        configurable: {
          context: {
            messageId: "msg-456",
            threadId: "thread-456",
            userId: "user-456",
            agentId: "agent-456",
            companyId: "company-456",
          },
        },
      };

      // Act
      try {
        await engine.streamGraph(mockGraph, config, jest.fn());
      } catch {
        // Expected to throw
      }

      // Assert - processEvent should have been called for events before error
      expect(mockEventProcessor.processEvent).toHaveBeenCalledTimes(2);
    });

    it("should not throw if webhook fails after graph error", async () => {
      // Arrange
      mockFetch.mockRejectedValue(new Error("Network error"));

      const mockGraph = {
        streamEvents: jest.fn().mockImplementation(async function* () {
          throw new Error("Graph execution failed");
        }),
      };

      const config = {
        input: { messages: [{ content: "test" }] },
        configurable: {
          context: {
            messageId: "msg-789",
            threadId: "thread-789",
            userId: "user-789",
            agentId: "agent-789",
            companyId: "company-789",
          },
        },
      };

      // Act & Assert - should throw original error, not webhook error
      await expect(
        engine.streamGraph(mockGraph, config, jest.fn())
      ).rejects.toThrow("Graph execution failed");
    });

    it("should skip webhook if context is missing", async () => {
      // Arrange
      const mockGraph = {
        streamEvents: jest.fn().mockImplementation(async function* () {
          yield { event: "on_chat_model_end", data: {} };
        }),
      };

      const config = {
        input: { messages: [{ content: "test" }] },
        configurable: {
          // No context provided
        },
      };

      // Act
      await engine.streamGraph(mockGraph, config, jest.fn());

      // Assert - webhook should not be called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should skip webhook if INTERNAL_API_TOKEN is not configured", async () => {
      // Arrange
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === "API_URL") return "http://test-backend";
        if (key === "INTERNAL_API_TOKEN") return undefined; // Not configured
        return undefined;
      });

      const mockGraph = {
        streamEvents: jest.fn().mockImplementation(async function* () {
          yield { event: "on_chat_model_end", data: {} };
        }),
      };

      const config = {
        input: { messages: [{ content: "test" }] },
        configurable: {
          context: {
            messageId: "msg-123",
            threadId: "thread-123",
            userId: "user-123",
            agentId: "agent-123",
            companyId: "company-123",
          },
        },
      };

      // Act
      await engine.streamGraph(mockGraph, config, jest.fn());

      // Assert - webhook should not be called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should handle event processing errors gracefully", async () => {
      // Arrange
      mockEventProcessor.processEvent.mockImplementation(() => {
        throw new Error("Event processing failed");
      });

      const mockGraph = {
        streamEvents: jest.fn().mockImplementation(async function* () {
          yield { event: "on_chat_model_stream", data: {} };
          yield { event: "on_chat_model_end", data: {} };
        }),
      };

      const config = {
        input: { messages: [{ content: "test" }] },
        configurable: {
          context: {
            messageId: "msg-123",
            threadId: "thread-123",
            userId: "user-123",
            agentId: "agent-123",
            companyId: "company-123",
          },
        },
      };

      // Act - should not throw despite event processing errors
      const result = await engine.streamGraph(mockGraph, config, jest.fn());

      // Assert
      expect(result).toBeDefined();
      // Both events were attempted to be processed
      expect(mockEventProcessor.processEvent).toHaveBeenCalledTimes(2);
    });

    it("should pass abort signal to graph config", async () => {
      // Arrange
      const abortController = new AbortController();
      const mockGraph = {
        streamEvents: jest.fn().mockImplementation(async function* () {
          yield { event: "on_chat_model_end", data: {} };
        }),
      };

      const config = {
        input: { messages: [{ content: "test" }] },
      };

      // Act
      await engine.streamGraph(
        mockGraph,
        config,
        jest.fn(),
        abortController.signal
      );

      // Assert
      expect(mockGraph.streamEvents).toHaveBeenCalledWith(
        config.input,
        expect.objectContaining({
          signal: abortController.signal,
        })
      );
    });
  });

  describe("invokeGraph", () => {
    it("should invoke graph and return processed result", async () => {
      // Arrange
      const mockGraph = {
        invoke: jest.fn().mockResolvedValue({
          text: "Invoked response",
          attachments: [],
          metadata: { model: "gpt-4" },
        }),
      };

      const preparedPayload = {
        input: { messages: [{ content: "test" }] },
        config: {},
      };

      // Act
      const result = await engine.invokeGraph(mockGraph, preparedPayload);

      // Assert
      expect(mockGraph.invoke).toHaveBeenCalledWith(preparedPayload.input, {
        signal: undefined,
      });
      expect(result).toEqual({
        text: "Invoked response",
        attachments: [],
        metadata: expect.objectContaining({ model: "gpt-4" }),
      });
    });

    it("should pass abort signal to invoke config", async () => {
      // Arrange
      const abortController = new AbortController();
      const mockGraph = {
        invoke: jest.fn().mockResolvedValue({
          text: "response",
          attachments: [],
          metadata: {},
        }),
      };

      const preparedPayload = {
        input: { messages: [{ content: "test" }] },
        config: {},
      };

      // Act
      await engine.invokeGraph(
        mockGraph,
        preparedPayload,
        abortController.signal
      );

      // Assert
      expect(mockGraph.invoke).toHaveBeenCalledWith(
        preparedPayload.input,
        expect.objectContaining({
          signal: abortController.signal,
        })
      );
    });

    it("should use config from preparedPayload", async () => {
      // Arrange
      const mockGraph = {
        invoke: jest.fn().mockResolvedValue({
          text: "response",
          attachments: [],
          metadata: {},
        }),
      };

      const preparedPayload = {
        input: { messages: [{ content: "test" }] },
        config: { recursionLimit: 50 },
      };

      // Act
      await engine.invokeGraph(mockGraph, preparedPayload);

      // Assert
      expect(mockGraph.invoke).toHaveBeenCalledWith(
        preparedPayload.input,
        expect.objectContaining({
          recursionLimit: 50,
          signal: undefined,
        })
      );
    });

    it("should pass through config properties from preparedPayload", async () => {
      // Arrange
      const mockGraph = {
        invoke: jest.fn().mockResolvedValue({
          text: "response",
          attachments: [],
          metadata: {},
        }),
      };

      const preparedPayload = {
        input: { messages: [{ content: "test" }] },
        config: {
          recursionLimit: 100,
          configurable: { customProp: "value" },
        },
      };

      // Act
      await engine.invokeGraph(mockGraph, preparedPayload);

      // Assert
      expect(mockGraph.invoke).toHaveBeenCalledWith(
        preparedPayload.input,
        expect.objectContaining({
          recursionLimit: 100,
          configurable: { customProp: "value" },
          signal: undefined,
        })
      );
    });
  });
});

describe("LangGraphEngine - config in streamGraph", () => {
  let engine: LangGraphEngine;
  let mockEventProcessor: EventProcessor;

  beforeEach(() => {
    mockEventProcessor = new EventProcessor();
    engine = new LangGraphEngine(mockEventProcessor, undefined);
  });

  it("should use config from preparedPayload in streamGraph", async () => {
    // Arrange
    const mockGraph = {
      streamEvents: jest.fn().mockImplementation(async function* () {
        yield { event: "on_chat_model_end", data: {} };
      }),
    };

    const preparedPayload = {
      input: { messages: [{ content: "test" }] },
      config: {
        configurable: {},
      },
    };

    // Act
    await engine.streamGraph(mockGraph, preparedPayload, jest.fn());

    // Assert
    expect(mockGraph.streamEvents).toHaveBeenCalledWith(
      preparedPayload.input,
      expect.objectContaining({
        version: "v2",
        signal: undefined,
      })
    );
  });

  it("should pass through all config properties in streamGraph", async () => {
    // Arrange
    const mockGraph = {
      streamEvents: jest.fn().mockImplementation(async function* () {
        yield { event: "on_chat_model_end", data: {} };
      }),
    };

    const preparedPayload = {
      input: { messages: [{ content: "test" }] },
      config: {
        configurable: {},
        recursionLimit: 75,
        customProp: "value",
      },
    };

    // Act
    await engine.streamGraph(mockGraph, preparedPayload, jest.fn());

    // Assert
    expect(mockGraph.streamEvents).toHaveBeenCalledWith(
      preparedPayload.input,
      expect.objectContaining({
        recursionLimit: 75,
        customProp: "value",
        version: "v2",
      })
    );
  });
});

describe("LangGraphEngine - Error Trace Preservation", () => {
  /**
   * Critical test: Ensures that trace data is ALWAYS sent for billing,
   * even when the graph execution fails with an error.
   *
   * This is important because:
   * 1. LLM tokens cost money and must be tracked for billing
   * 2. If graph fails after LLM call, tokens were already spent
   * 3. Without this fix, those tokens would be lost from billing
   */
  it("should preserve and send trace for billing even when graph fails mid-execution", async () => {
    // Create real EventProcessor to test full integration
    const realEventProcessor = new EventProcessor();

    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === "API_URL") return "http://test-backend";
        if (key === "INTERNAL_API_TOKEN") return "test-token";
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    const engine = new LangGraphEngine(realEventProcessor, mockConfigService);

    // Simulate a graph that:
    // 1. Starts LLM call
    // 2. Gets partial response (tokens are spent!)
    // 3. Fails with error
    const mockGraph = {
      streamEvents: jest.fn().mockImplementation(async function* () {
        // LLM started - tokens will be spent
        yield {
          event: "on_chat_model_start",
          name: "ChatOpenAI",
          metadata: { langgraph_node: "agent" },
          data: {},
        };

        // Partial response received - tokens were spent
        yield {
          event: "on_chat_model_stream",
          name: "ChatOpenAI",
          metadata: { langgraph_node: "agent", stream_channel: "text" },
          data: { chunk: { content: "I can help you with" } },
        };

        // LLM completed - we have usage data
        yield {
          event: "on_chat_model_end",
          name: "ChatOpenAI",
          metadata: {
            langgraph_node: "agent",
            usage: { prompt_tokens: 50, completion_tokens: 10 },
          },
          data: {
            output: { content: "I can help you with that" },
          },
        };

        // Then something fails (e.g., tool execution, network, etc.)
        throw new Error("Tool execution failed: API timeout");
      }),
    };

    const config = {
      input: { messages: [{ content: "Help me with task" }] },
      configurable: {
        context: {
          messageId: "billing-test-msg",
          threadId: "billing-test-thread",
          userId: "billing-test-user",
          agentId: "billing-test-agent",
          companyId: "billing-test-company",
        },
      },
    };

    // Act
    let caughtError: Error | null = null;
    try {
      await engine.streamGraph(mockGraph, config, jest.fn());
    } catch (error) {
      caughtError = error as Error;
    }

    // Assert
    // 1. Error should be thrown
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe("Tool execution failed: API timeout");

    // 2. But trace webhook should have been called!
    expect(mockFetch).toHaveBeenCalled();

    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toBe(
      "http://test-backend/internal/usage/trace-events/batch"
    );

    const requestBody = JSON.parse(fetchCall[1].body);

    // 3. Trace should contain the LLM events for billing
    expect(requestBody.events.length).toBeGreaterThan(0);
    expect(requestBody.messageId).toBe("billing-test-msg");
    expect(requestBody.companyId).toBe("billing-test-company");

    // 4. Status should indicate error
    expect(requestBody.status).toBe("error");
    expect(requestBody.error.message).toBe(
      "Tool execution failed: API timeout"
    );
  });
});

describe("LangGraphEngine - extractThreadId & cleanup", () => {
  let engine: LangGraphEngine;
  let mockEventProcessor: jest.Mocked<EventProcessor>;

  beforeEach(() => {
    jest.clearAllMocks();
    clearAttachmentDataStore();

    mockEventProcessor = {
      createAccumulator: jest.fn().mockReturnValue({
        channels: new Map(),
        attachments: [],
        metadata: {},
        traceEvents: [],
        traceStartedAt: Date.now(),
        traceCompletedAt: null,
      }),
      processEvent: jest.fn(),
      getResult: jest.fn().mockReturnValue({
        content: { text: "", contentChains: [], attachments: [], metadata: {} },
        trace: null,
      }),
    } as unknown as jest.Mocked<EventProcessor>;

    engine = new LangGraphEngine(mockEventProcessor, undefined);
  });

  afterEach(() => {
    clearAttachmentDataStore();
  });

  it("should extract threadId from config.configurable.thread_id", async () => {
    storeAttachmentData("tool_1", "data", "tid-from-config");

    const mockGraph = {
      invoke: jest
        .fn()
        .mockResolvedValue({ text: "", attachments: [], metadata: {} }),
    };

    await engine.invokeGraph(mockGraph, {
      input: {},
      config: { configurable: { thread_id: "tid-from-config" } },
    });

    // Data should have been cleaned up
    expect(getAttachmentData("tool_1", "tid-from-config")).toBeUndefined();
  });

  it("should extract threadId from config.configurable.context.threadId", async () => {
    storeAttachmentData("tool_1", "data", "tid-from-context");

    const mockGraph = {
      invoke: jest
        .fn()
        .mockResolvedValue({ text: "", attachments: [], metadata: {} }),
    };

    await engine.invokeGraph(mockGraph, {
      input: {},
      config: { configurable: { context: { threadId: "tid-from-context" } } },
    });

    expect(getAttachmentData("tool_1", "tid-from-context")).toBeUndefined();
  });

  it("should extract threadId from top-level configurable.thread_id", async () => {
    storeAttachmentData("tool_1", "data", "tid-top-level");

    const mockGraph = {
      invoke: jest
        .fn()
        .mockResolvedValue({ text: "", attachments: [], metadata: {} }),
    };

    await engine.invokeGraph(mockGraph, {
      input: {},
      configurable: { thread_id: "tid-top-level" },
    });

    expect(getAttachmentData("tool_1", "tid-top-level")).toBeUndefined();
  });

  it("should not clean up when no threadId is present", async () => {
    storeAttachmentData("tool_1", "data", "some-thread");

    const mockGraph = {
      invoke: jest
        .fn()
        .mockResolvedValue({ text: "", attachments: [], metadata: {} }),
    };

    await engine.invokeGraph(mockGraph, {
      input: {},
      config: {},
    });

    // Data should still be there — no threadId to clean up
    expect(getAttachmentData("tool_1", "some-thread")).toBe("data");
  });
});
