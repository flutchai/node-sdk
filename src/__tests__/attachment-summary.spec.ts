import {
  generateAttachmentSummary,
  createGraphAttachment,
} from "../tools/attachment-summary";

describe("generateAttachmentSummary", () => {
  const toolCallId = "call_abc123";

  describe("tabular data (array of objects)", () => {
    it("should show row/column counts and sample rows", () => {
      const data = [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Charlie" },
      ];

      const summary = generateAttachmentSummary(data, toolCallId);

      expect(summary).toContain("3 rows, 2 columns");
      expect(summary).toContain("id, name");
      expect(summary).toContain("Sample data:");
      expect(summary).toContain(JSON.stringify(data[0]));
      expect(summary).toContain(`[Data stored as attachment: ${toolCallId}]`);
    });

    it("should limit sample rows to 5", () => {
      const data = Array.from({ length: 20 }, (_, i) => ({ i }));

      const summary = generateAttachmentSummary(data, toolCallId);

      expect(summary).toContain("20 rows");
      // 6th row should not appear in summary
      expect(summary).not.toContain(JSON.stringify({ i: 5 }));
    });

    it("should handle single-row tabular data", () => {
      const data = [{ x: 1 }];
      const summary = generateAttachmentSummary(data, toolCallId);

      expect(summary).toContain("1 rows, 1 columns");
      expect(summary).toContain(JSON.stringify({ x: 1 }));
    });
  });

  describe("text / non-tabular data", () => {
    it("should show character count and preview for strings", () => {
      const data = "Hello world";
      const summary = generateAttachmentSummary(data, toolCallId);

      expect(summary).toContain(`${data.length} characters`);
      expect(summary).toContain("Preview: Hello world");
      expect(summary).toContain(`[Data stored as attachment: ${toolCallId}]`);
    });

    it("should truncate long text with ellipsis", () => {
      const data = "x".repeat(1000);
      const summary = generateAttachmentSummary(data, toolCallId);

      expect(summary).toContain("1000 characters");
      expect(summary).toContain("...");
    });

    it("should handle plain numbers", () => {
      const summary = generateAttachmentSummary(42, toolCallId);
      expect(summary).toContain("Preview: 42");
    });

    it("should handle null", () => {
      const summary = generateAttachmentSummary(null, toolCallId);
      expect(summary).toContain("Preview: null");
    });

    it("should handle nested objects (non-tabular)", () => {
      const data = { nested: { a: 1 } };
      const summary = generateAttachmentSummary(data, toolCallId);
      expect(summary).toContain("Preview:");
      expect(summary).toContain(`[Data stored as attachment: ${toolCallId}]`);
    });
  });

  describe("edge cases", () => {
    it("should handle empty array as text summary", () => {
      const summary = generateAttachmentSummary([], toolCallId);
      expect(summary).toContain("Preview: []");
    });

    it("should handle array of primitives as text summary", () => {
      const summary = generateAttachmentSummary([1, 2, 3], toolCallId);
      expect(summary).toContain("Preview:");
      expect(summary).toContain(`[Data stored as attachment: ${toolCallId}]`);
    });
  });
});

describe("createGraphAttachment", () => {
  it("should return a valid IGraphAttachment", () => {
    const now = Date.now();
    const result = createGraphAttachment([{ id: 1 }], "my_tool", "call_xyz");

    expect(result).toMatchObject({
      data: [{ id: 1 }],
      toolName: "my_tool",
      toolCallId: "call_xyz",
    });
    expect(result.summary).toContain("1 rows");
    expect(result.createdAt).toBeGreaterThanOrEqual(now);
  });
});
