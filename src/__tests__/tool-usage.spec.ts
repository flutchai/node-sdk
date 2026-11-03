import { ToolMessage } from "@langchain/core/messages";
import { McpRuntimeHttpClient } from "../tools/mcp-runtime-http.client";
import { McpConverter } from "../tools/mcp-converter";
import {
  toolEndContent,
  toolEndOutput,
  toolUsageOf,
} from "../tools/tool-usage";

const mockPost = jest.fn();
const mockHandleToolEnd = jest.fn();

jest.mock("axios", () => {
  const instance = {
    get: jest.fn(),
    post: (...a: unknown[]) => mockPost(...a),
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
      post: (...a: unknown[]) => mockPost(...a),
      isAxiosError: jest.fn(() => false),
    },
    isAxiosError: jest.fn(() => false),
  };
});

jest.mock("@langchain/core/callbacks/manager", () => {
  const actual = jest.requireActual("@langchain/core/callbacks/manager");
  return {
    ...actual,
    CallbackManager: {
      ...actual.CallbackManager,
      configure: jest.fn(() => ({
        handleToolStart: jest.fn(async () => ({
          handleToolEnd: (...a: unknown[]) => mockHandleToolEnd(...a),
          handleToolError: jest.fn(),
        })),
      })),
    },
  };
});

describe("tool usage helpers", () => {
  it("keeps a cost only when it is a number of dollars", () => {
    expect(toolUsageOf({ total_cost: 0.018 })).toEqual({ total_cost: 0.018 });
    expect(toolUsageOf({ total_cost: 0 })).toEqual({ total_cost: 0 });
    expect(toolUsageOf({ total_cost: "0.1" })).toBeUndefined();
    expect(toolUsageOf({ total_cost: -1 })).toBeUndefined();
    expect(toolUsageOf(undefined)).toBeUndefined();
  });

  it("gives the end event the text alone, or the text with its cost", () => {
    expect(toolEndOutput("done")).toBe("done");
    expect(toolEndOutput("done", { total_cost: 0.2 })).toEqual({
      content: "done",
      usage_metadata: { total_cost: 0.2 },
    });
  });

  it("reads the text the client shows off an output with a cost", () => {
    expect(
      toolEndContent({ content: "done", usage_metadata: { total_cost: 0.2 } })
    ).toBe("done");
    expect(
      toolEndContent(
        new ToolMessage({
          content: "done",
          tool_call_id: "c1",
          artifact: { usage_metadata: { total_cost: 0.2 } },
        })
      )
    ).toBe("done");
    expect(toolEndContent({ content: "no cost" })).toBeUndefined();
    expect(toolEndContent("text")).toBeUndefined();
  });
});

describe("McpRuntimeHttpClient.executeToolWithEvents with a paid tool", () => {
  beforeEach(() => jest.clearAllMocks());

  it("keeps the cost out of the content and puts it on the end event", async () => {
    mockPost.mockResolvedValue({
      data: {
        success: true,
        result: { hits: 3 },
        usage_metadata: { total_cost: 0.008 },
      },
    });
    const client = new McpRuntimeHttpClient("http://localhost:3004");

    const response = await client.executeToolWithEvents(
      "call_1",
      "web_search",
      { query: "q" },
      {}
    );

    expect(response.content).toBe(
      JSON.stringify({ success: true, result: { hits: 3 } })
    );
    expect(response.usageMetadata).toEqual({ total_cost: 0.008 });
    expect(mockHandleToolEnd).toHaveBeenCalledWith({
      content: response.content,
      usage_metadata: { total_cost: 0.008 },
    });
  });

  it("ends a call without a cost with its text alone", async () => {
    mockPost.mockResolvedValue({ data: { success: true, result: "ok" } });
    const client = new McpRuntimeHttpClient("http://localhost:3004");

    const response = await client.executeToolWithEvents("c2", "kb", {}, {});

    expect(response.usageMetadata).toBeUndefined();
    expect(mockHandleToolEnd).toHaveBeenCalledWith(response.content);
  });
});

describe("McpConverter with a paid tool", () => {
  it("puts the cost on the ToolMessage's artifact, out of its content", async () => {
    mockPost.mockResolvedValue({
      data: {
        success: true,
        result: "three hits",
        usage_metadata: { total_cost: 0.008 },
      },
    });
    const converter = new McpConverter("http://localhost:3004");
    const tool = converter.convertTool({
      name: "web_search",
      description: "Search",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    });

    const message: unknown = await tool.invoke({
      id: "call_1",
      name: "web_search",
      args: { query: "q" },
      type: "tool_call",
    });

    if (!(message instanceof ToolMessage)) throw new Error("not a ToolMessage");
    expect(message.content).toBe("three hits");
    expect(message.artifact).toEqual({ usage_metadata: { total_cost: 0.008 } });
  });
});
