import { McpConverter } from "../tools/mcp-converter";
import { McpTool } from "../tools/mcp.interfaces";
import axios from "axios";

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("McpConverter", () => {
  let converter: McpConverter;
  const testMcpRuntimeUrl = "http://localhost:3004";

  beforeEach(() => {
    jest.clearAllMocks();
    converter = new McpConverter(testMcpRuntimeUrl);
  });

  describe("convertTool", () => {
    const mockTool: McpTool = {
      name: "test_tool",
      description: "A test tool",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    };

    it("should convert MCP tool to LangChain DynamicStructuredTool", () => {
      const tool = converter.convertTool(mockTool);

      expect(tool.name).toBe("test_tool");
      expect(tool.description).toContain("A test tool");
      expect(tool.schema).toBeDefined();
    });

    it("should pass context with threadId to MCP Runtime when invoking tool", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: true,
          result: "test result",
        },
      });

      const tool = converter.convertTool(mockTool);

      // Invoke with RunnableConfig containing configurable
      const result = await tool.invoke(
        { query: "test query" },
        {
          configurable: {
            thread_id: "test-thread-123",
            agentId: "test-agent-456",
            userId: "test-user-789",
          },
        }
      );

      // Verify axios was called with context
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${testMcpRuntimeUrl}/tools/execute`,
        {
          name: "test_tool",
          arguments: { query: "test query" },
          context: {
            threadId: "test-thread-123",
            agentId: "test-agent-456",
            userId: "test-user-789",
          },
        },
        { timeout: 30000 }
      );

      expect(result).toBe("test result");
    });

    it("should pass empty context when configurable is not provided", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: true,
          result: "test result",
        },
      });

      const tool = converter.convertTool(mockTool);

      // Invoke without config
      await tool.invoke({ query: "test query" });

      // Verify axios was called with undefined context values
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${testMcpRuntimeUrl}/tools/execute`,
        {
          name: "test_tool",
          arguments: { query: "test query" },
          context: {
            threadId: undefined,
            agentId: undefined,
            userId: undefined,
          },
        },
        { timeout: 30000 }
      );
    });

    it("should handle partial context (only some fields provided)", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: true,
          result: "test result",
        },
      });

      const tool = converter.convertTool(mockTool);

      // Invoke with partial config (only agentId)
      await tool.invoke(
        { query: "test query" },
        {
          configurable: {
            agentId: "test-agent-only",
          },
        }
      );

      // Verify axios was called with partial context
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${testMcpRuntimeUrl}/tools/execute`,
        {
          name: "test_tool",
          arguments: { query: "test query" },
          context: {
            threadId: undefined,
            agentId: "test-agent-only",
            userId: undefined,
          },
        },
        { timeout: 30000 }
      );
    });

    it("should throw error when tool execution fails", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: false,
          error: "Tool execution failed",
        },
      });

      const tool = converter.convertTool(mockTool);

      await expect(tool.invoke({ query: "test query" })).rejects.toThrow(
        "Tool execution failed"
      );
    });

    it("should handle axios errors gracefully", async () => {
      const axiosError = new Error("Network error");
      (axiosError as any).isAxiosError = true;
      mockedAxios.post.mockRejectedValueOnce(axiosError);
      // Use Object.defineProperty to properly mock isAxiosError
      Object.defineProperty(mockedAxios, "isAxiosError", {
        value: () => true,
        writable: true,
      });

      const tool = converter.convertTool(mockTool);

      await expect(tool.invoke({ query: "test query" })).rejects.toThrow(
        "MCP Runtime error: Network error"
      );
    });
  });

  describe("convertTools", () => {
    it("should convert multiple MCP tools", async () => {
      const mockTools: McpTool[] = [
        {
          name: "tool1",
          description: "First tool",
          inputSchema: {
            type: "object",
            properties: { input: { type: "string" } },
          },
        },
        {
          name: "tool2",
          description: "Second tool",
          inputSchema: {
            type: "object",
            properties: { value: { type: "number" } },
          },
        },
      ];

      const tools = await converter.convertTools(mockTools);

      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("tool1");
      expect(tools[1].name).toBe("tool2");
    });
  });

  describe("fetchAndConvertTools", () => {
    it("should fetch tools from MCP Runtime and convert them", async () => {
      const mockTools: McpTool[] = [
        {
          name: "fetched_tool",
          description: "A fetched tool",
          inputSchema: {
            type: "object",
            properties: { data: { type: "string" } },
          },
        },
      ];

      mockedAxios.get.mockResolvedValueOnce({
        data: mockTools,
      });

      const tools = await converter.fetchAndConvertTools();

      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${testMcpRuntimeUrl}/tools/list`,
        { params: {}, timeout: 5000 }
      );
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("fetched_tool");
    });

    it("should pass filter to MCP Runtime", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: [],
      });

      await converter.fetchAndConvertTools("calendar");

      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${testMcpRuntimeUrl}/tools/list`,
        { params: { filter: "calendar" }, timeout: 5000 }
      );
    });

    it("should throw error when MCP Runtime is unavailable", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Connection refused"));

      await expect(converter.fetchAndConvertTools()).rejects.toThrow(
        `Cannot connect to MCP Runtime at ${testMcpRuntimeUrl}`
      );
    });
  });

  describe("healthCheck", () => {
    it("should return true when MCP Runtime is healthy", async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: { status: "ok" },
      });

      const isHealthy = await converter.healthCheck();

      expect(isHealthy).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${testMcpRuntimeUrl}/tools/health/check`,
        { timeout: 5000 }
      );
    });

    it("should return false when MCP Runtime is unhealthy", async () => {
      mockedAxios.get.mockRejectedValueOnce(new Error("Connection refused"));

      const isHealthy = await converter.healthCheck();

      expect(isHealthy).toBe(false);
    });
  });
});

describe("McpConverter - Context Extraction for Goal Tracking", () => {
  /**
   * Critical test: Ensures that threadId is passed to MCP Runtime
   * for goal tracking functionality (issue #548)
   *
   * Without threadId, goal tracking won't work because:
   * 1. MCP Runtime needs threadId to associate goals with conversations
   * 2. Backend validates that threadId is present
   * 3. Goals are stored per-thread for analytics
   */
  it("should extract all context fields for goal tracking", async () => {
    const converter = new McpConverter("http://test-mcp-runtime");
    const mockedAxios = axios as jest.Mocked<typeof axios>;

    mockedAxios.post.mockResolvedValueOnce({
      data: { success: true, result: "booked" },
    });

    const mockTool: McpTool = {
      name: "calendar_book_meeting",
      description: "Book a meeting",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          datetime: { type: "string" },
        },
        required: ["title", "datetime"],
      },
    };

    const tool = converter.convertTool(mockTool);

    // Simulate real graph execution context
    await tool.invoke(
      { title: "Team meeting", datetime: "2026-01-25T10:00:00Z" },
      {
        configurable: {
          thread_id: "thread-abc123",
          agentId: "agent-xyz789",
          userId: "user-456",
          graphSettings: { someConfig: true },
        },
      }
    );

    // Verify the full context is passed for goal tracking
    const callArgs = mockedAxios.post.mock.calls[0];
    const requestBody = callArgs[1] as { context: Record<string, unknown> };

    expect(requestBody.context).toEqual({
      threadId: "thread-abc123",
      agentId: "agent-xyz789",
      userId: "user-456",
    });

    // This context will allow MCP Runtime to call:
    // reportGoalAchieved('meeting_booked', { meetingId: '...' })
  });
});
