import { HumanMessage } from "@langchain/core/messages";
import { compactTraceMessages } from "../engines/langgraph/event-processor.utils";

const history = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    type: i === 0 ? "system" : "human",
    content: `m${i}`,
  }));

describe("compactTraceMessages", () => {
  it("keeps the first message and the last six of a long state history", () => {
    const data = compactTraceMessages({
      input: { messages: history(30) },
    }) as any;
    const kept = data.input.messages;

    expect(kept).toHaveLength(8);
    expect(kept[0].content).toBe("m0");
    expect(kept[1]).toEqual({ type: "trace_omitted", omittedMessages: 23 });
    expect(kept.slice(2).map((m: any) => m.content)).toEqual([
      "m24",
      "m25",
      "m26",
      "m27",
      "m28",
      "m29",
    ]);
  });

  it("compacts each history of a chat model input ([[...]])", () => {
    const data = compactTraceMessages({
      input: { messages: [history(20)] },
    }) as any;
    expect(data.input.messages[0]).toHaveLength(8);
  });

  it("compacts a bare list of LangChain messages, such as a node's input", () => {
    const messages = Array.from(
      { length: 20 },
      (_, i) => new HumanMessage(`m${i}`)
    );
    const data = compactTraceMessages({ input: messages }) as any;

    expect(data.input).toHaveLength(8);
    expect(data.input[1]).toEqual({
      type: "trace_omitted",
      omittedMessages: 13,
    });
  });

  it("leaves short histories and everything else as is", () => {
    const value = {
      output: { messages: history(5) },
      other: [1, 2, 3],
      rows: Array.from({ length: 20 }, (_, i) => ({ id: i })),
      text: "x",
    };
    expect(compactTraceMessages(value)).toEqual(value);
  });
});
