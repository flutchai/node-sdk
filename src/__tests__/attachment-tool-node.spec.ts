import { ToolMessage } from "@langchain/core/messages";
import {
  executeToolWithAttachments,
  ExecuteToolWithAttachmentsParams,
  DEFAULT_ATTACHMENT_THRESHOLD,
  _internals,
} from "../graph/attachment-tool-node";
import { IGraphAttachment, McpRuntimeHttpClient } from "../tools";

// Mock McpRuntimeHttpClient
const createMockMcpClient = (response: {
  content: string;
  success: boolean;
  rawResult?: any;
}) =>
  ({
    executeToolWithEvents: jest.fn().mockResolvedValue(response),
  }) as unknown as McpRuntimeHttpClient;

// Helper to create test attachments
const createTestAttachment = (
  id: string,
  data: any,
  createdAt = Date.now()
): IGraphAttachment => ({
  data,
  summary: `Summary for ${id}`,
  toolName: "test_tool",
  toolCallId: id,
  createdAt,
});

describe("attachment-tool-node", () => {
  describe("DEFAULT_ATTACHMENT_THRESHOLD", () => {
    it("should be 4000 by default", () => {
      // env not set in test, so default is 4000
      expect(DEFAULT_ATTACHMENT_THRESHOLD).toBe(4000);
    });
  });

  describe("_internals.shouldInjectData", () => {
    const { shouldInjectData } = _internals;

    it("should return false when attachments are empty", () => {
      expect(shouldInjectData({ data: undefined }, {}, "data")).toBe(false);
    });

    it("should return true when data arg is undefined", () => {
      const attachments = { call_1: createTestAttachment("call_1", [1, 2, 3]) };
      expect(shouldInjectData({}, attachments, "data")).toBe(true);
      expect(shouldInjectData({ other: "value" }, attachments, "data")).toBe(
        true
      );
    });

    it("should return false when data arg has any value (including falsy)", () => {
      const attachments = { call_1: createTestAttachment("call_1", [1, 2, 3]) };

      // String values should NOT be overwritten
      expect(
        shouldInjectData({ data: "user provided" }, attachments, "data")
      ).toBe(false);
      expect(shouldInjectData({ data: "" }, attachments, "data")).toBe(false);

      // Other falsy values should NOT be overwritten
      expect(shouldInjectData({ data: 0 }, attachments, "data")).toBe(false);
      expect(shouldInjectData({ data: false }, attachments, "data")).toBe(
        false
      );
      expect(shouldInjectData({ data: null }, attachments, "data")).toBe(false);

      // Truthy values should NOT be overwritten
      expect(shouldInjectData({ data: [1, 2] }, attachments, "data")).toBe(
        false
      );
      expect(
        shouldInjectData({ data: { key: "val" } }, attachments, "data")
      ).toBe(false);
    });

    it("should respect custom injectIntoArg", () => {
      const attachments = { call_1: createTestAttachment("call_1", [1, 2, 3]) };

      expect(shouldInjectData({}, attachments, "input")).toBe(true);
      expect(shouldInjectData({ input: "value" }, attachments, "input")).toBe(
        false
      );
      expect(shouldInjectData({ data: "value" }, attachments, "input")).toBe(
        true
      );
    });
  });

  describe("_internals.getLatestAttachment", () => {
    const { getLatestAttachment } = _internals;

    it("should return undefined for empty attachments", () => {
      expect(getLatestAttachment({})).toBeUndefined();
    });

    it("should return the only attachment when there is one", () => {
      const attachment = createTestAttachment("call_1", [1]);
      expect(getLatestAttachment({ call_1: attachment })).toBe(attachment);
    });

    it("should return the most recent attachment by createdAt", () => {
      const older = createTestAttachment("call_1", [1], 1000);
      const newer = createTestAttachment("call_2", [2], 2000);
      const oldest = createTestAttachment("call_0", [0], 500);

      const result = getLatestAttachment({
        call_1: older,
        call_2: newer,
        call_0: oldest,
      });

      expect(result).toBe(newer);
    });
  });

  describe("executeToolWithAttachments", () => {
    const baseParams: Omit<ExecuteToolWithAttachmentsParams, "mcpClient"> = {
      toolCall: { id: "call_123", name: "test_tool", args: {} },
      enrichedArgs: { query: "SELECT * FROM users" },
      executionContext: { userId: "user_1" },
      attachments: {},
    };

    describe("small results (below threshold)", () => {
      it("should return ToolMessage with full content", async () => {
        const mcpClient = createMockMcpClient({
          content: '{"success":true,"result":"small"}',
          success: true,
          rawResult: "small",
        });

        const result = await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
        });

        expect(result.toolMessage).toBeInstanceOf(ToolMessage);
        expect(result.toolMessage.content).toBe(
          '{"success":true,"result":"small"}'
        );
        expect(result.toolMessage.tool_call_id).toBe("call_123");
        expect(result.attachment).toBeUndefined();
      });
    });

    describe("large results (above threshold)", () => {
      it("should create attachment and return summary in ToolMessage", async () => {
        const largeData = Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
        }));
        const largeContent = JSON.stringify({
          success: true,
          result: largeData,
        });

        const mcpClient = createMockMcpClient({
          content: largeContent,
          success: true,
          rawResult: largeData,
        });

        const result = await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          threshold: 100, // Low threshold to trigger attachment
        });

        expect(result.attachment).toBeDefined();
        expect(result.attachment!.key).toBe("call_123");
        expect(result.attachment!.value.data).toBeNull(); // Data stored in memory, not in state
        expect(result.attachment!.value.toolName).toBe("test_tool");
        expect(result.toolMessage.content).toContain("100 rows");
        expect(result.toolMessage.content).toContain(
          "[Data stored as attachment:"
        );
      });

      it("should respect custom threshold", async () => {
        const data = "x".repeat(5000);
        const mcpClient = createMockMcpClient({
          content: data,
          success: true,
          rawResult: data,
        });

        // With high threshold, should NOT create attachment
        const result1 = await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          threshold: 10000,
        });
        expect(result1.attachment).toBeUndefined();

        // With low threshold, SHOULD create attachment
        const result2 = await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          threshold: 1000,
        });
        expect(result2.attachment).toBeDefined();
      });
    });

    describe("auto-injection", () => {
      it("should inject data from latest attachment when data arg is missing", async () => {
        const attachmentData = [{ id: 1, name: "Alice" }];
        const attachments = {
          call_old: createTestAttachment("call_old", [{ old: true }], 1000),
          call_new: createTestAttachment("call_new", attachmentData, 2000),
        };

        const mcpClient = createMockMcpClient({
          content: '{"success":true}',
          success: true,
        });

        await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          attachments,
          enrichedArgs: { operation: "transform" }, // No data arg
        });

        expect(mcpClient.executeToolWithEvents).toHaveBeenCalledWith(
          "call_123",
          "test_tool",
          expect.objectContaining({
            operation: "transform",
            data: JSON.stringify(attachmentData),
          }),
          expect.any(Object),
          undefined
        );
      });

      it("should inject from specific attachment when sourceAttachmentId is provided", async () => {
        const targetData = { specific: true };
        const attachments = {
          call_target: createTestAttachment("call_target", targetData, 1000),
          call_latest: createTestAttachment(
            "call_latest",
            { latest: true },
            2000
          ),
        };

        const mcpClient = createMockMcpClient({
          content: '{"success":true}',
          success: true,
        });

        await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          attachments,
          enrichedArgs: {},
          sourceAttachmentId: "call_target",
        });

        expect(mcpClient.executeToolWithEvents).toHaveBeenCalledWith(
          "call_123",
          "test_tool",
          expect.objectContaining({
            data: JSON.stringify(targetData),
          }),
          expect.any(Object),
          undefined
        );
      });

      it("should inject into custom injectIntoArg", async () => {
        const attachmentData = [1, 2, 3];
        const attachments = {
          call_1: createTestAttachment("call_1", attachmentData),
        };

        const mcpClient = createMockMcpClient({
          content: '{"success":true}',
          success: true,
        });

        await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          attachments,
          enrichedArgs: {},
          injectIntoArg: "input",
        });

        expect(mcpClient.executeToolWithEvents).toHaveBeenCalledWith(
          "call_123",
          "test_tool",
          expect.objectContaining({
            input: JSON.stringify(attachmentData),
          }),
          expect.any(Object),
          undefined
        );
      });

      it("should NOT inject when data arg already has a value", async () => {
        const attachments = {
          call_1: createTestAttachment("call_1", [{ injected: true }]),
        };

        const mcpClient = createMockMcpClient({
          content: '{"success":true}',
          success: true,
        });

        await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          attachments,
          enrichedArgs: { data: "user-provided-data" },
        });

        expect(mcpClient.executeToolWithEvents).toHaveBeenCalledWith(
          "call_123",
          "test_tool",
          expect.objectContaining({
            data: "user-provided-data", // Original value preserved
          }),
          expect.any(Object),
          undefined
        );
      });

      it("should preserve string attachment data without double-stringifying", async () => {
        const stringData = "already a string";
        const attachments = {
          call_1: createTestAttachment("call_1", stringData),
        };

        const mcpClient = createMockMcpClient({
          content: '{"success":true}',
          success: true,
        });

        await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          attachments,
          enrichedArgs: {},
        });

        expect(mcpClient.executeToolWithEvents).toHaveBeenCalledWith(
          "call_123",
          "test_tool",
          expect.objectContaining({
            data: stringData, // Not JSON.stringify(stringData)
          }),
          expect.any(Object),
          undefined
        );
      });
    });

    describe("error handling", () => {
      it("should return ToolMessage with error content on tool failure", async () => {
        const mcpClient = createMockMcpClient({
          content: '{"success":false,"error":"Tool failed"}',
          success: false,
        });

        const result = await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
        });

        expect(result.toolMessage.content).toContain("error");
        expect(result.attachment).toBeUndefined();
      });

      it("should fallback gracefully when injection fails", async () => {
        // Create attachments that will cause getLatestAttachment to fail
        const badAttachments = {
          get call_1() {
            throw new Error("Boom");
          },
        } as unknown as Record<string, IGraphAttachment>;

        const mcpClient = createMockMcpClient({
          content: '{"success":true}',
          success: true,
        });

        const logger = {
          log: jest.fn(),
          warn: jest.fn(),
          debug: jest.fn(),
        };

        // Should not throw, should log warning
        const result = await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          attachments: badAttachments,
          logger,
        });

        expect(result.toolMessage).toBeDefined();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("[Attachment] Auto-injection failed")
        );
      });
    });

    describe("logging", () => {
      it("should log debug messages for injection and attachment creation", async () => {
        const attachments = {
          call_prev: createTestAttachment("call_prev", [1, 2, 3]),
        };

        const largeContent = "x".repeat(5000);
        const mcpClient = createMockMcpClient({
          content: largeContent,
          success: true,
          rawResult: largeContent,
        });

        const logger = {
          log: jest.fn(),
          warn: jest.fn(),
          debug: jest.fn(),
        };

        await executeToolWithAttachments({
          ...baseParams,
          mcpClient,
          attachments,
          enrichedArgs: {},
          logger,
          threshold: 100,
        });

        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining("Auto-injected data")
        );
        expect(logger.debug).toHaveBeenCalledWith(
          expect.stringContaining("Stored large result")
        );
      });
    });
  });
});
