/**
 * Tests for outgoing reasoning-block sanitizing (Bedrock Converse).
 *
 * Claude Opus 5 returns "thinking" as a signature-only reasoning block. Sending
 * that block back as history makes Bedrock reject the whole request with
 * `ValidationException: ... reasoningContent.reasoningText.text ... Member must
 * not be null`, which killed every multi-step tool call.
 *
 * What is pinned down here:
 *   a) a block with `text: null` / missing text → removed
 *   b) a block with real reasoning text        → passed through untouched
 *   c) `tool_calls` and plain text blocks      → never lost
 *   d) an old-model history                    → not touched at all (identity)
 */

import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
} from "@langchain/core/messages";
import { ToolMessage } from "@langchain/core/messages/tool";

import {
  isReasoningBlock,
  isSendableReasoningBlock,
  sanitizeMessageReasoning,
  sanitizeReasoningForBedrock,
} from "../models/reasoning-content.logic";

const SIGNATURE = "CAISiQIKcAgQEAEYAipACenalKdouuYnIcH5wipNRY";

describe("isReasoningBlock", () => {
  it("recognizes reasoning blocks and nothing else", () => {
    expect(isReasoningBlock({ type: "reasoning_content" })).toBe(true);
    expect(isReasoningBlock({ type: "text", text: "hi" })).toBe(false);
    expect(isReasoningBlock("plain string")).toBe(false);
    expect(isReasoningBlock(null)).toBe(false);
  });
});

describe("isSendableReasoningBlock", () => {
  it("accepts a block with real reasoning text", () => {
    expect(
      isSendableReasoningBlock({
        type: "reasoning_content",
        reasoningText: { text: "let me think", signature: SIGNATURE },
      })
    ).toBe(true);
  });

  it("accepts a redactedContent block", () => {
    expect(
      isSendableReasoningBlock({
        type: "reasoning_content",
        redactedContent: "YmFzZTY0",
      })
    ).toBe(true);
  });

  it.each([
    ["null text", { text: null, signature: SIGNATURE }],
    ["missing text", { signature: SIGNATURE }],
    ["empty text", { text: "", signature: SIGNATURE }],
    ["empty reasoningText", {}],
  ])("rejects a block with %s", (_label, reasoningText) => {
    expect(
      isSendableReasoningBlock({
        type: "reasoning_content",
        reasoningText: reasoningText as { text?: string | null },
      })
    ).toBe(false);
  });
});

describe("sanitizeMessageReasoning", () => {
  it("drops a signature-only reasoning block (Claude Opus 5 shape)", () => {
    const message = new AIMessageChunk({
      content: [
        { type: "reasoning_content", reasoningText: { signature: SIGNATURE } },
      ],
      tool_calls: [
        {
          name: "sales_summary",
          args: { days: 7 },
          id: "tu_1",
          type: "tool_call",
        },
      ],
    });

    const cleaned = sanitizeMessageReasoning(message);

    expect(cleaned).not.toBe(message);
    expect(cleaned.content).toEqual([]);
    // Original message untouched — it lives in LangGraph state.
    expect(message.content).toHaveLength(1);
  });

  it("drops a reasoning block whose text is explicitly null", () => {
    const message = new AIMessage({
      content: [
        { type: "text", text: "Считаю выручку" },
        {
          type: "reasoning_content",
          reasoningText: { text: null, signature: SIGNATURE },
        },
      ] as never,
    });

    const cleaned = sanitizeMessageReasoning(message);

    expect(cleaned.content).toEqual([{ type: "text", text: "Считаю выручку" }]);
  });

  it("passes a block with real reasoning text through untouched", () => {
    const message = new AIMessage({
      content: [
        {
          type: "reasoning_content",
          reasoningText: {
            text: "step 1: sum the orders",
            signature: SIGNATURE,
          },
        },
        { type: "text", text: "Готово" },
      ] as never,
    });

    expect(sanitizeMessageReasoning(message)).toBe(message);
  });

  it("keeps tool_calls and text when a bad reasoning block is dropped", () => {
    const message = new AIMessageChunk({
      content: [
        { type: "reasoning_content", reasoningText: { signature: SIGNATURE } },
        { type: "text", text: "Сейчас посмотрю" },
      ],
      tool_calls: [
        {
          name: "audience_summary",
          args: { days: 7 },
          id: "tu_2",
          type: "tool_call",
        },
        {
          name: "sales_summary",
          args: { days: 30 },
          id: "tu_3",
          type: "tool_call",
        },
      ],
      id: "run-abc",
    });

    const cleaned = sanitizeMessageReasoning(message) as AIMessageChunk;

    expect(cleaned.content).toEqual([
      { type: "text", text: "Сейчас посмотрю" },
    ]);
    expect(cleaned.tool_calls).toHaveLength(2);
    expect(cleaned.tool_calls?.map(tc => tc.name)).toEqual([
      "audience_summary",
      "sales_summary",
    ]);
    expect(cleaned.tool_calls?.[0].args).toEqual({ days: 7 });
    expect(cleaned.id).toBe("run-abc");
    expect(cleaned.getType()).toBe("ai");
    expect(AIMessageChunk.isInstance(cleaned)).toBe(true);
  });

  it("keeps a normalized block instead of emptying the message", () => {
    // Assistant turn cut off mid-thinking: nothing but an unsendable block and
    // no tool calls. `content: []` is rejected by Bedrock too, so the signature
    // is preserved with the non-null `text` the schema demands.
    const message = new AIMessage({
      content: [
        { type: "reasoning_content", reasoningText: { signature: SIGNATURE } },
      ] as never,
    });

    const cleaned = sanitizeMessageReasoning(message);

    expect(cleaned.content).toEqual([
      {
        type: "reasoning_content",
        reasoningText: { text: "", signature: SIGNATURE },
      },
    ]);
  });

  it("leaves human and tool messages alone", () => {
    const human = new HumanMessage({
      content: [
        { type: "reasoning_content", reasoningText: { signature: SIGNATURE } },
      ] as never,
    });
    const tool = new ToolMessage({ content: "42", tool_call_id: "tu_1" });

    expect(sanitizeMessageReasoning(human)).toBe(human);
    expect(sanitizeMessageReasoning(tool)).toBe(tool);
  });

  it("leaves string content alone", () => {
    const message = new AIMessage("просто текст");
    expect(sanitizeMessageReasoning(message)).toBe(message);
  });
});

describe("sanitizeReasoningForBedrock", () => {
  it("returns the same array for a history without reasoning (old models)", () => {
    const history = [
      new HumanMessage("сколько я заработала за неделю?"),
      new AIMessageChunk({
        content: "",
        tool_calls: [
          {
            name: "sales_summary",
            args: { days: 7 },
            id: "tu_1",
            type: "tool_call",
          },
        ],
      }),
      new ToolMessage({ content: '{"revenue":12345}', tool_call_id: "tu_1" }),
      new AIMessage("За неделю 12 345 ₽."),
    ];

    const result = sanitizeReasoningForBedrock(history);

    expect(result.messages).toBe(history);
    expect(result.sanitized).toBe(0);
    result.messages.forEach((m, i) => expect(m).toBe(history[i]));
  });

  it("returns the same array when every reasoning block is valid", () => {
    const history = [
      new HumanMessage("посчитай"),
      new AIMessage({
        content: [
          {
            type: "reasoning_content",
            reasoningText: { text: "сначала суммирую", signature: SIGNATURE },
          },
          { type: "text", text: "Готово" },
        ] as never,
      }),
    ];

    expect(sanitizeReasoningForBedrock(history).messages).toBe(history);
  });

  it("sanitizes only the offending messages and counts them", () => {
    const good = new AIMessage("всё хорошо");
    const human = new HumanMessage("а теперь за месяц");
    const bad = new AIMessageChunk({
      content: [
        { type: "reasoning_content", reasoningText: { signature: SIGNATURE } },
      ],
      tool_calls: [
        {
          name: "sales_summary",
          args: { days: 30 },
          id: "tu_9",
          type: "tool_call",
        },
      ],
    });

    const history = [human, good, bad];
    const result = sanitizeReasoningForBedrock(history);

    expect(result.messages).not.toBe(history);
    expect(result.sanitized).toBe(1);
    expect(result.messages[0]).toBe(human);
    expect(result.messages[1]).toBe(good);
    expect(result.messages[2]).not.toBe(bad);
    expect(result.messages[2].content).toEqual([]);
  });

  it("is idempotent", () => {
    const history = [
      new HumanMessage("вопрос"),
      new AIMessageChunk({
        content: [
          {
            type: "reasoning_content",
            reasoningText: { signature: SIGNATURE },
          },
        ],
        tool_calls: [{ name: "t", args: {}, id: "tu_1", type: "tool_call" }],
      }),
    ];

    const once = sanitizeReasoningForBedrock(history);
    const twice = sanitizeReasoningForBedrock(once.messages);

    expect(twice.messages).toBe(once.messages);
    expect(twice.sanitized).toBe(0);
  });
});
