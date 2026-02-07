/**
 * Tests for the attachment data store:
 * - Thread-scoped isolation (no data leaks between concurrent requests)
 * - Auto-cleanup after timeout
 * - Cleanup API (clearAttachmentDataStore)
 * - Null/undefined data handling
 * - Integration with executeToolWithAttachments
 */
import {
  storeAttachmentData,
  getAttachmentData,
  clearAttachmentDataStore,
  executeToolWithAttachments,
  ExecuteToolWithAttachmentsParams,
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

describe("Attachment data store", () => {
  afterEach(() => {
    // Clean up all data after each test
    clearAttachmentDataStore();
  });

  describe("Thread-scoped isolation", () => {
    it("should isolate data between different threadIds", () => {
      storeAttachmentData("tool_1", { rows: [1, 2, 3] }, "thread_A");
      storeAttachmentData("tool_1", { rows: [4, 5, 6] }, "thread_B");

      expect(getAttachmentData("tool_1", "thread_A")).toEqual({
        rows: [1, 2, 3],
      });
      expect(getAttachmentData("tool_1", "thread_B")).toEqual({
        rows: [4, 5, 6],
      });
    });

    it("should return undefined for non-existent thread", () => {
      storeAttachmentData("tool_1", "data", "thread_A");

      expect(getAttachmentData("tool_1", "thread_B")).toBeUndefined();
      expect(getAttachmentData("tool_1", "thread_C")).toBeUndefined();
    });

    it("should return undefined for non-existent key within thread", () => {
      storeAttachmentData("tool_1", "data", "thread_A");

      expect(getAttachmentData("tool_2", "thread_A")).toBeUndefined();
    });

    it("should use __global__ scope when no threadId provided", () => {
      storeAttachmentData("tool_1", "global_data");

      expect(getAttachmentData("tool_1")).toBe("global_data");
      // Should not be accessible from specific threads
      expect(getAttachmentData("tool_1", "thread_A")).toBeUndefined();
    });
  });

  describe("clearAttachmentDataStore", () => {
    it("should clear only the specified thread", () => {
      storeAttachmentData("tool_1", "data_A", "thread_A");
      storeAttachmentData("tool_1", "data_B", "thread_B");

      clearAttachmentDataStore("thread_A");

      expect(getAttachmentData("tool_1", "thread_A")).toBeUndefined();
      expect(getAttachmentData("tool_1", "thread_B")).toBe("data_B");
    });

    it("should clear all threads when no threadId provided", () => {
      storeAttachmentData("tool_1", "data_A", "thread_A");
      storeAttachmentData("tool_1", "data_B", "thread_B");
      storeAttachmentData("tool_1", "data_global");

      clearAttachmentDataStore();

      expect(getAttachmentData("tool_1", "thread_A")).toBeUndefined();
      expect(getAttachmentData("tool_1", "thread_B")).toBeUndefined();
      expect(getAttachmentData("tool_1")).toBeUndefined();
    });

    it("should not throw when clearing non-existent thread", () => {
      expect(() => clearAttachmentDataStore("nonexistent")).not.toThrow();
    });
  });

  describe("Auto-cleanup timer", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      clearAttachmentDataStore();
    });

    it("should auto-cleanup after 10 minutes", () => {
      storeAttachmentData("tool_1", "big_data", "thread_timer");

      expect(getAttachmentData("tool_1", "thread_timer")).toBe("big_data");

      // Advance time by 10 minutes
      jest.advanceTimersByTime(10 * 60 * 1000);

      expect(getAttachmentData("tool_1", "thread_timer")).toBeUndefined();
    });

    it("should reset timer when new data is stored for the same thread", () => {
      storeAttachmentData("tool_1", "first", "thread_reset");

      // Advance 7 minutes (not enough to trigger 10-min timer)
      jest.advanceTimersByTime(7 * 60 * 1000);

      // Store more data — should reset the 10-minute timer
      storeAttachmentData("tool_2", "second", "thread_reset");

      // Advance another 7 minutes (14 min total from first store,
      // but only 7 min from second store — timer should NOT have fired)
      jest.advanceTimersByTime(7 * 60 * 1000);

      expect(getAttachmentData("tool_1", "thread_reset")).toBe("first");
      expect(getAttachmentData("tool_2", "thread_reset")).toBe("second");

      // Advance past the reset timer (3 more minutes = 10 min from second store)
      jest.advanceTimersByTime(3 * 60 * 1000);

      expect(getAttachmentData("tool_1", "thread_reset")).toBeUndefined();
      expect(getAttachmentData("tool_2", "thread_reset")).toBeUndefined();
    });

    it("should cancel timer when thread is manually cleared", () => {
      storeAttachmentData("tool_1", "data", "thread_cancel");

      // Clear before timeout fires
      clearAttachmentDataStore("thread_cancel");

      // Store new data under same thread
      storeAttachmentData("tool_2", "new_data", "thread_cancel");

      // Advance past old timer
      jest.advanceTimersByTime(10 * 60 * 1000);

      // New timer should have also fired, but the data from the
      // second store should have its own timer
      // (the old timer was cleared, new one started)
      expect(getAttachmentData("tool_2", "thread_cancel")).toBeUndefined();
    });
  });

  describe("Null data fallback in auto-injection", () => {
    const baseParams: Omit<ExecuteToolWithAttachmentsParams, "mcpClient"> = {
      toolCall: { id: "call_123", name: "test_tool", args: {} },
      enrichedArgs: {},
      executionContext: { userId: "user_1" },
      attachments: {},
    };

    it("should NOT inject when both memory store and state have null data", async () => {
      // Simulate: store was cleared (storedData=undefined), state has data:null
      const attachments = {
        call_prev: createTestAttachment("call_prev", null), // data: null in state
      };

      const mcpClient = createMockMcpClient({
        content: '{"success":true}',
        success: true,
      });

      await executeToolWithAttachments({
        ...baseParams,
        mcpClient,
        attachments,
        enrichedArgs: { query: "SELECT 1" },
        threadId: "thread_null_test",
      });

      // Should NOT inject null — original args should be preserved
      expect(mcpClient.executeToolWithEvents).toHaveBeenCalledWith(
        "call_123",
        "test_tool",
        expect.objectContaining({ query: "SELECT 1" }),
        expect.any(Object),
        undefined
      );

      // Verify "data" key was NOT added
      const calledArgs = (mcpClient.executeToolWithEvents as jest.Mock).mock
        .calls[0][2];
      expect(calledArgs).not.toHaveProperty("data");
    });

    it("should inject from memory store when state has data:null", async () => {
      // Store data in memory for this thread
      storeAttachmentData(
        "call_prev",
        [{ id: 1, name: "Alice" }],
        "thread_inject"
      );

      const attachments = {
        call_prev: createTestAttachment("call_prev", null), // data: null in state
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
        threadId: "thread_inject",
      });

      // Should inject from memory store
      expect(mcpClient.executeToolWithEvents).toHaveBeenCalledWith(
        "call_123",
        "test_tool",
        expect.objectContaining({
          data: JSON.stringify([{ id: 1, name: "Alice" }]),
        }),
        expect.any(Object),
        undefined
      );
    });

    it("should store data scoped to threadId during large result handling", async () => {
      const largeData = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
      }));
      const largeContent = JSON.stringify({ success: true, result: largeData });

      const mcpClient = createMockMcpClient({
        content: largeContent,
        success: true,
        rawResult: largeData,
      });

      const result = await executeToolWithAttachments({
        ...baseParams,
        mcpClient,
        threshold: 100,
        threadId: "thread_store_test",
      });

      expect(result.attachment).toBeDefined();
      // Data should be in memory store under the correct thread
      expect(getAttachmentData("call_123", "thread_store_test")).toEqual(
        largeData
      );
      // Should NOT be accessible from another thread
      expect(getAttachmentData("call_123", "other_thread")).toBeUndefined();
      // State attachment should have data: null
      expect(result.attachment!.value.data).toBeNull();
    });
  });
});
