import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  refTraceMessages,
  TraceMessageStore,
} from "../engines/langgraph/event-processor.utils";

const newStore = (): TraceMessageStore => ({
  messages: {},
  keys: new WeakMap(),
});

describe("refTraceMessages", () => {
  it("keeps each message of a growing history once and refers to it", () => {
    const system = new SystemMessage("prompt");
    const question = new HumanMessage("question");
    const store = newStore();

    // Two steps of a run: the second carries the first one's history again.
    const first = refTraceMessages(
      { input: { messages: [system] } },
      store
    ) as any;
    const second = refTraceMessages(
      { input: { messages: [[system, question]] } },
      store
    ) as any;

    expect(first.input.messages).toEqual([{ _traceMsg: "m1" }]);
    expect(second.input.messages).toEqual([
      [{ _traceMsg: "m1" }, { _traceMsg: "m2" }],
    ]);
    expect(Object.keys(store.messages)).toEqual(["m1", "m2"]);
    expect(JSON.stringify(store.messages.m2)).toContain("question");
  });

  it("refers to a bare list of messages, such as a node's input", () => {
    const store = newStore();
    const messages = [new HumanMessage("a"), new HumanMessage("b")];

    const data = refTraceMessages({ input: messages }, store) as any;

    expect(data.input).toEqual([{ _traceMsg: "m1" }, { _traceMsg: "m2" }]);
  });

  it("keeps long messages whole up to the trace string limit", () => {
    const store = newStore();
    const page = "x".repeat(60_000);

    refTraceMessages({ messages: [new HumanMessage(page)] }, store);

    expect(JSON.stringify(store.messages.m1)).toContain(page);
  });

  it("leaves other values as they are", () => {
    const value = { other: [1, 2, 3], rows: [{ id: 1 }], text: "x" };
    expect(refTraceMessages(value, newStore())).toEqual(value);
  });
});
