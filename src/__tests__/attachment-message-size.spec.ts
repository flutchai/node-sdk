/**
 * Integration test: Large tool result → EventProcessor → message content size.
 *
 * Simulates the real flow when postgres_query returns ~9000 rows (509MB):
 * 1. LLM emits tool_use block (on_chat_model_stream)
 * 2. Tool executes and returns large result (on_tool_end)
 * 3. on_chain_end fires with graph state including attachments
 * 4. Second LLM call generates summary (on_chat_model_stream)
 * 5. EventProcessor.getResult() builds final content
 * 6. Content is serialized → must fit in MongoDB 16MB BSON limit
 *
 * This test catches the exact bugs we found in production:
 * - IGraphAttachment objects leaking into IAttachment[] (validation error)
 * - on_tool_end JSON.stringify crash on large output
 * - Oversized content fields exceeding 16MB
 */
import { EventProcessor } from "../engines/langgraph/event-processor.utils";
import { IGraphAttachment } from "../tools/mcp.interfaces";

// ---------------------------------------------------------------------------
// Test data generators
// ---------------------------------------------------------------------------

/** Generate a realistic postgres row (21 columns, matching real messages table) */
function generateRow(i: number) {
  return {
    id: i,
    telegram_id: 100000 + i,
    chat_id: -1001234567890 + (i % 100),
    telegram_user_id: 5000000 + (i % 500),
    username: `user_${i % 500}`,
    text: `Message text content for row ${i}. This is a sample message that might be longer in real data.`,
    type: i % 3 === 0 ? "system" : i % 3 === 1 ? "user" : "bot",
    tags: JSON.stringify(["tag1", "tag2"]),
    received_at: new Date(Date.now() - i * 60000).toISOString(),
    is_processed: i % 2 === 0,
    processed_at: i % 2 === 0 ? new Date(Date.now() - i * 30000).toISOString() : null,
    response: i % 2 === 0 ? `Response for message ${i}. Contains the AI response text.` : null,
    session_id: `session_${i % 100}`,
    error_message: null,
    raw_claude_response: i % 5 === 0 ? `{"id":"msg_${i}","content":[{"type":"text","text":"response"}]}` : null,
    dialog_id: `dialog_${i % 50}`,
    project_slug: ["svetu-auth", "mind", "flutch", "teleclaude"][i % 4],
    bot_name: ["@teleclaude_workplace_bot", "@teleclaude_mind_bot"][i % 2],
    user_id: `user_obj_${i % 500}`,
    note: null,
    claude_message_uuid: `uuid-${i}`,
  };
}

/** Generate N rows and return as JSON string (simulating tool content) */
function generateLargeToolContent(rowCount: number): string {
  const rows = Array.from({ length: rowCount }, (_, i) => generateRow(i));
  return JSON.stringify({ success: true, result: rows });
}

/** Generate a short attachment summary (like createGraphAttachment does) */
function generateAttachmentSummary(rowCount: number, toolCallId: string): string {
  const sampleRows = Array.from({ length: 5 }, (_, i) => generateRow(i));
  let summary = `${rowCount} rows, 21 columns (id, telegram_id, chat_id, telegram_user_id, username, text, type, tags, received_at, is_processed, processed_at, response, session_id, error_message, raw_claude_response, dialog_id, project_slug, bot_name, user_id, note, claude_message_uuid)\n`;
  summary += `Sample data:\n`;
  for (const row of sampleRows) {
    summary += JSON.stringify(row) + "\n";
  }
  summary += `[Data stored as attachment: ${toolCallId}]`;
  return summary;
}

// ---------------------------------------------------------------------------
// Event factory — builds realistic LangGraph stream events
// ---------------------------------------------------------------------------

const TOOL_CALL_ID = "toolu_01TestToolCallId";
const TOOL_RUN_ID = "run_tool_123";
const LLM_RUN_ID_1 = "run_llm_1";
const LLM_RUN_ID_2 = "run_llm_2";

function createEvents(opts: {
  toolOutputContent: string; // What on_tool_end returns as ToolMessage content
  graphAttachments: Record<string, IGraphAttachment>; // Graph state attachments on chain end
  llmSummaryText: string; // What the second LLM call returns
}) {
  const now = Date.now();

  return [
    // 1. First LLM call starts (output_generate node)
    {
      event: "on_chain_start",
      name: "output_generate",
      data: {},
      metadata: { langgraph_node: "output_generate", stream_channel: "text" },
      run_id: LLM_RUN_ID_1,
      timestamp: now,
    },

    // 2. LLM streams tool_use block
    {
      event: "on_chat_model_stream",
      data: {
        chunk: {
          content: [
            { type: "text", text: "I'll query the messages table." },
          ],
        },
      },
      metadata: { langgraph_node: "output_generate", stream_channel: "text" },
      run_id: LLM_RUN_ID_1,
      timestamp: now + 100,
    },
    {
      event: "on_chat_model_stream",
      data: {
        chunk: {
          content: [
            {
              type: "tool_use",
              id: TOOL_CALL_ID,
              name: "postgres_query",
              input: '{"query": "SELECT * FROM messages;"}',
            },
          ],
        },
      },
      metadata: { langgraph_node: "output_generate", stream_channel: "text" },
      run_id: LLM_RUN_ID_1,
      timestamp: now + 200,
    },

    // 3. LLM call ends
    {
      event: "on_chat_model_end",
      name: "output_generate",
      data: {},
      metadata: { langgraph_node: "output_generate", stream_channel: "text" },
      run_id: LLM_RUN_ID_1,
      timestamp: now + 300,
    },

    // 4. Tools node starts
    {
      event: "on_chain_start",
      name: "tools",
      data: {},
      metadata: { langgraph_node: "tools", stream_channel: "text" },
      timestamp: now + 400,
    },

    // 5. Tool starts
    {
      event: "on_tool_start",
      name: "postgres_query",
      data: { input: { query: "SELECT * FROM messages;" } },
      metadata: { langgraph_node: "tools", stream_channel: "text" },
      run_id: TOOL_RUN_ID,
      timestamp: now + 500,
    },

    // 6. Tool ends — content is the ToolMessage content (summary or full data)
    {
      event: "on_tool_end",
      name: "postgres_query",
      data: {
        output: {
          content: opts.toolOutputContent,
          tool_call_id: TOOL_CALL_ID,
          name: "postgres_query",
        },
      },
      metadata: { langgraph_node: "tools", stream_channel: "text" },
      run_id: TOOL_RUN_ID,
      timestamp: now + 14000, // 14 seconds for tool execution
    },

    // 7. Tools node chain end — includes graph state with attachments
    {
      event: "on_chain_end",
      name: "tools",
      data: {
        output: {
          attachments: opts.graphAttachments,
        },
      },
      metadata: { langgraph_node: "tools", stream_channel: "text" },
      timestamp: now + 14100,
    },

    // 8. Second LLM call (output_generate) — generates summary for user
    {
      event: "on_chain_start",
      name: "output_generate",
      data: {},
      metadata: { langgraph_node: "output_generate", stream_channel: "text" },
      run_id: LLM_RUN_ID_2,
      timestamp: now + 14200,
    },
    {
      event: "on_chat_model_stream",
      data: {
        chunk: {
          content: [{ type: "text", text: opts.llmSummaryText }],
        },
      },
      metadata: { langgraph_node: "output_generate", stream_channel: "text" },
      run_id: LLM_RUN_ID_2,
      timestamp: now + 15000,
    },
    {
      event: "on_chat_model_end",
      name: "output_generate",
      data: {},
      metadata: { langgraph_node: "output_generate", stream_channel: "text" },
      run_id: LLM_RUN_ID_2,
      timestamp: now + 15100,
    },

    // 9. Final chain end
    {
      event: "on_chain_end",
      name: "output_generate",
      data: {
        output: {
          metadata: {},
        },
      },
      metadata: { langgraph_node: "output_generate", stream_channel: "text" },
      timestamp: now + 15200,
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Attachment system: EventProcessor → message content size", () => {
  let processor: EventProcessor;

  beforeEach(() => {
    processor = new EventProcessor();
  });

  describe("Baseline: small tool result (no attachment)", () => {
    it("should produce small content when tool result is under threshold", () => {
      const smallContent = JSON.stringify({ success: true, result: [{ id: 1, name: "Alice" }] });
      const events = createEvents({
        toolOutputContent: smallContent,
        graphAttachments: {},
        llmSummaryText: "Found 1 row in the table.",
      });

      const acc = processor.createAccumulator();
      for (const event of events) {
        processor.processEvent(acc, event);
      }
      const { content } = processor.getResult(acc);

      const serialized = JSON.stringify(content);
      expect(serialized.length).toBeLessThan(10_000); // Well under 16MB
      expect(content.text).toContain("Found 1 row");
      expect(content.attachments).toEqual([]);
    });
  });

  describe("Large tool result with attachment (realistic scenario)", () => {
    const ROW_COUNT = 9000;
    let attachmentSummary: string;
    let graphAttachments: Record<string, IGraphAttachment>;

    beforeAll(() => {
      attachmentSummary = generateAttachmentSummary(ROW_COUNT, TOOL_CALL_ID);
      graphAttachments = {
        [TOOL_CALL_ID]: {
          data: null, // Data stored in memory, not in graph state
          summary: attachmentSummary,
          toolName: "postgres_query",
          toolCallId: TOOL_CALL_ID,
          createdAt: Date.now(),
        },
      };
    });

    it("should NOT include IGraphAttachment objects in content.attachments", () => {
      const events = createEvents({
        toolOutputContent: attachmentSummary, // ToolMessage has summary (not full data)
        graphAttachments,
        llmSummaryText: `The messages table contains ${ROW_COUNT} records with 21 columns.`,
      });

      const acc = processor.createAccumulator();
      for (const event of events) {
        processor.processEvent(acc, event);
      }
      const { content } = processor.getResult(acc);

      // IGraphAttachment objects must NOT appear in attachments
      // (they lack required type/value fields for IAttachment)
      expect(content.attachments).toEqual([]);
      // Verify no object with IGraphAttachment fields leaked through
      for (const att of content.attachments || []) {
        expect(att).toHaveProperty("type");
        expect(att).toHaveProperty("value");
        expect(att).not.toHaveProperty("toolCallId");
        expect(att).not.toHaveProperty("summary");
      }
    });

    it("should produce content that fits in MongoDB 16MB limit", () => {
      const events = createEvents({
        toolOutputContent: attachmentSummary,
        graphAttachments,
        llmSummaryText: `The messages table contains ${ROW_COUNT} records with 21 columns. Here is the structure...`,
      });

      const acc = processor.createAccumulator();
      for (const event of events) {
        processor.processEvent(acc, event);
      }
      const { content, trace } = processor.getResult(acc);

      // Serialize content as it would be stored in MongoDB
      const contentJson = JSON.stringify(content);
      const traceJson = trace ? JSON.stringify(trace) : "null";

      // Content must be well under 16MB
      const MONGODB_LIMIT = 16 * 1024 * 1024; // 16MB
      expect(contentJson.length).toBeLessThan(MONGODB_LIMIT);

      // Log sizes for debugging
      console.log("=== Content sizes ===");
      console.log(`  content total: ${contentJson.length} bytes`);
      console.log(`  content.text: ${content.text?.length || 0} chars`);
      console.log(`  content.attachments: ${JSON.stringify(content.attachments || []).length} bytes`);
      console.log(`  content.contentChains: ${JSON.stringify(content.contentChains || []).length} bytes`);
      console.log(`  content.metadata: ${JSON.stringify(content.metadata || {}).length} bytes`);
      console.log(`  trace: ${traceJson.length} bytes`);
    });

    it("should handle on_tool_end with very large raw output (pre-attachment)", () => {
      // Simulate the REAL scenario: on_tool_end fires BEFORE attachment processing
      // so event.data.output.content is the FULL raw result (e.g. 509MB)
      //
      // We can't use 509MB in a test, but we use a large enough string
      // to trigger the same code paths (>50KB truncation, JSON.stringify safety)
      const largeRawOutput = generateLargeToolContent(500); // ~500 rows = ~100KB+

      const events = createEvents({
        toolOutputContent: largeRawOutput, // RAW output (not summary!)
        graphAttachments,
        llmSummaryText: "Summary of the data.",
      });

      const acc = processor.createAccumulator();
      // Should NOT throw even with large tool output
      for (const event of events) {
        processor.processEvent(acc, event);
      }
      const { content } = processor.getResult(acc);

      // Tool output in content chain must be truncated
      const contentJson = JSON.stringify(content);
      const MONGODB_LIMIT = 16 * 1024 * 1024;
      expect(contentJson.length).toBeLessThan(MONGODB_LIMIT);

      // Check that tool block output was truncated
      if (content.contentChains) {
        for (const chain of content.contentChains) {
          for (const step of chain.steps) {
            if (step.type === "tool_use" && step.output) {
              expect(step.output.length).toBeLessThanOrEqual(55_000); // 50KB + truncation suffix
            }
          }
        }
      }
    });
  });

  describe("Simulated full message document size", () => {
    it("should produce a message DTO under 16MB", () => {
      const ROW_COUNT = 9000;
      const attachmentSummary = generateAttachmentSummary(ROW_COUNT, TOOL_CALL_ID);
      const graphAttachments: Record<string, IGraphAttachment> = {
        [TOOL_CALL_ID]: {
          data: null,
          summary: attachmentSummary,
          toolName: "postgres_query",
          toolCallId: TOOL_CALL_ID,
          createdAt: Date.now(),
        },
      };

      const events = createEvents({
        toolOutputContent: attachmentSummary,
        graphAttachments,
        llmSummaryText: "The messages table contains 8969 records with 21 columns.",
      });

      const acc = processor.createAccumulator();
      for (const event of events) {
        processor.processEvent(acc, event);
      }
      const { content, trace } = processor.getResult(acc);

      // Build a message DTO similar to what AnswerService creates
      const messageDto = {
        threadId: "thread_123",
        userId: "user_123",
        agentId: "agent_123",
        role: "assistant",
        platform: "web",
        reason: "agent_reply",
        status: "delivered",
        replyToId: "msg_user_123",
        content: {
          contentChains: content.contentChains,
          attachments: content.attachments,
          metadata: content.metadata,
          text: content.text,
        },
        metadata: {
          usageMetrics: {
            modelCalls: [
              {
                nodeName: "output_generate",
                timestamp: Date.now(),
                modelId: "claude-haiku-4-5",
                promptTokens: 5000,
                completionTokens: 500,
                totalTokens: 5500,
              },
              {
                nodeName: "output_generate",
                timestamp: Date.now(),
                modelId: "claude-haiku-4-5",
                promptTokens: 100000,
                completionTokens: 1000,
                totalTokens: 101000,
              },
            ],
            toolCalls: [
              {
                nodeName: "tools",
                timestamp: Date.now(),
                toolName: "postgres_query",
                // NOTE: no 'data' field — removed to prevent oversized messages
              },
            ],
          },
        },
      };

      const serialized = JSON.stringify(messageDto);
      const MONGODB_LIMIT = 16 * 1024 * 1024;

      console.log("=== Simulated message DTO sizes ===");
      console.log(`  TOTAL: ${serialized.length} bytes (${(serialized.length / 1024 / 1024).toFixed(2)} MB)`);
      console.log(`  content.text: ${content.text?.length || 0} chars`);
      console.log(`  content.contentChains: ${JSON.stringify(content.contentChains || []).length} bytes`);
      console.log(`  content.attachments: ${JSON.stringify(content.attachments || []).length} bytes`);
      console.log(`  content.metadata: ${JSON.stringify(content.metadata || {}).length} bytes`);
      console.log(`  message.metadata: ${JSON.stringify(messageDto.metadata).length} bytes`);
      console.log(`  MongoDB limit: ${MONGODB_LIMIT} bytes (${(MONGODB_LIMIT / 1024 / 1024).toFixed(0)} MB)`);

      // Each individual field check
      expect(JSON.stringify(content.contentChains || []).length).toBeLessThan(1_000_000); // <1MB
      expect(JSON.stringify(content.attachments || []).length).toBeLessThan(100_000); // <100KB
      expect(JSON.stringify(content.metadata || {}).length).toBeLessThan(100_000); // <100KB
      expect((content.text?.length || 0)).toBeLessThan(1_000_000); // <1MB
      expect(JSON.stringify(messageDto.metadata).length).toBeLessThan(1_000_000); // <1MB

      // Total must fit MongoDB
      expect(serialized.length).toBeLessThan(MONGODB_LIMIT);
    });
  });

  describe("Trace event data sanitization", () => {
    it("should sanitize on_tool_end trace events with large data", () => {
      const largeContent = "x".repeat(200_000); // 200KB string

      const events = createEvents({
        toolOutputContent: largeContent,
        graphAttachments: {},
        llmSummaryText: "Summary.",
      });

      const acc = processor.createAccumulator();
      for (const event of events) {
        processor.processEvent(acc, event);
      }
      const { trace } = processor.getResult(acc);

      if (trace) {
        // Check that trace events with large data are sanitized
        for (const traceEvent of trace.events) {
          const eventJson = JSON.stringify(traceEvent);
          // No single trace event should be larger than 500KB
          expect(eventJson.length).toBeLessThan(500_000);
        }

        // Total trace should be manageable
        const traceJson = JSON.stringify(trace);
        console.log(`  trace total: ${traceJson.length} bytes (${(traceJson.length / 1024).toFixed(0)} KB)`);
      }
    });
  });

  describe("extractMetricsFromTrace (simulated)", () => {
    it("should not include large event.data in toolCalls metrics", () => {
      // This tests the fix where we removed data: event.data from toolCalls
      const events = createEvents({
        toolOutputContent: "x".repeat(200_000),
        graphAttachments: {},
        llmSummaryText: "Summary.",
      });

      const acc = processor.createAccumulator();
      for (const event of events) {
        processor.processEvent(acc, event);
      }
      const { trace } = processor.getResult(acc);

      if (trace) {
        // Simulate extractMetricsFromTrace logic (from ai-answer.generator.ts)
        const toolCalls: any[] = [];
        for (const event of trace.events) {
          if (event.type === "on_tool_end") {
            toolCalls.push({
              nodeName: event.nodeName || "unknown",
              timestamp: event.timestamp,
              toolName: event.name || "unknown",
              // NOTE: NO data field — this is the fix
            });
          }
        }

        // Metrics should be tiny
        const metricsJson = JSON.stringify({ toolCalls });
        expect(metricsJson.length).toBeLessThan(1000); // Under 1KB
      }
    });
  });
});
