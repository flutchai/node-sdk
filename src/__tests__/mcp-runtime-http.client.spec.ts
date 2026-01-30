import axios from "axios";
import { McpRuntimeHttpClient } from "../tools/mcp-runtime-http.client";

// Mock axios
jest.mock("axios", () => {
  const mockInstance = {
    get: jest.fn(),
    post: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockInstance),
      isAxiosError: jest.fn(() => false),
    },
    isAxiosError: jest.fn(() => false),
  };
});

// Mock CallbackManager to avoid real LangChain callback processing
jest.mock("@langchain/core/callbacks/manager", () => ({
  CallbackManager: {
    configure: jest.fn(() => null),
  },
  parseCallbackConfigArg: jest.fn(() => ({
    callbacks: undefined,
    runId: undefined,
    tags: undefined,
    metadata: undefined,
  })),
}));

function getHttpClient(): any {
  const client = new McpRuntimeHttpClient("http://localhost:3004");
  return (client as any).httpClient;
}

describe("McpRuntimeHttpClient", () => {
  let client: McpRuntimeHttpClient;
  let mockHttp: any;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new McpRuntimeHttpClient("http://localhost:3004");
    mockHttp = (client as any).httpClient;
  });

  describe("executeToolWithEvents", () => {
    it("should return rawResult on success", async () => {
      const toolResult = {
        success: true,
        result: [{ id: 1, name: "Alice" }],
      };
      mockHttp.post.mockResolvedValue({ data: toolResult });

      const response = await client.executeToolWithEvents(
        "call_123",
        "search_users",
        { query: "Alice" },
        { userId: "u1" }
      );

      expect(response.success).toBe(true);
      expect(response.rawResult).toEqual([{ id: 1, name: "Alice" }]);
      expect(response.content).toBe(JSON.stringify(toolResult));
    });

    it("should not include rawResult on failure", async () => {
      const toolResult = {
        success: false,
        error: "Tool not found",
      };
      mockHttp.post.mockResolvedValue({ data: toolResult });

      const response = await client.executeToolWithEvents(
        "call_456",
        "missing_tool",
        {},
        {}
      );

      expect(response.success).toBe(false);
      expect(response.rawResult).toBeUndefined();
      expect(response.content).toBe("Tool not found");
    });

    it("should not include rawResult on exception", async () => {
      mockHttp.post.mockRejectedValue(new Error("Network error"));

      const response = await client.executeToolWithEvents(
        "call_789",
        "broken_tool",
        {},
        {}
      );

      expect(response.success).toBe(false);
      expect(response.rawResult).toBeUndefined();
      expect(response.content).toContain("Network error");
    });

    it("should preserve rawResult structure for tabular data", async () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        value: `row-${i}`,
      }));
      mockHttp.post.mockResolvedValue({
        data: { success: true, result: rows },
      });

      const response = await client.executeToolWithEvents(
        "call_big",
        "get_report",
        {},
        {}
      );

      expect(response.rawResult).toHaveLength(100);
      expect(response.rawResult[0]).toEqual({ id: 0, value: "row-0" });
    });

    it("should handle success with undefined result", async () => {
      mockHttp.post.mockResolvedValue({
        data: { success: true, result: undefined },
      });

      const response = await client.executeToolWithEvents(
        "call_void",
        "void_tool",
        {},
        {}
      );

      expect(response.success).toBe(true);
      expect(response.rawResult).toBeUndefined();
    });

    it("should handle success with string result", async () => {
      mockHttp.post.mockResolvedValue({
        data: { success: true, result: "plain text response" },
      });

      const response = await client.executeToolWithEvents(
        "call_str",
        "text_tool",
        {},
        {}
      );

      expect(response.success).toBe(true);
      expect(response.rawResult).toBe("plain text response");
    });
  });
});
