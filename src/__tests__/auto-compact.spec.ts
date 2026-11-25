import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  RemoveMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  messagesStateReducer,
  REMOVE_ALL_MESSAGES,
} from "@langchain/langgraph";
import {
  autoCompact,
  contextTokens,
  isCompactSummary,
  planCompaction,
  renderTranscript,
  resolveAutoCompactSettings,
  ResolvedAutoCompactSettings,
  SummaryModel,
} from "../messages/auto-compact";

const settings = (
  over: Partial<ResolvedAutoCompactSettings> = {}
): ResolvedAutoCompactSettings => ({
  triggerTokens: 4_000,
  keepRecentTurns: 1,
  ...over,
});

const big = (n: number) => "x".repeat(n);

function answered(input: number): AIMessage {
  return new AIMessage({
    content: [
      { type: "thinking", thinking: "let me think", signature: "sig" },
      { type: "text", text: "answer" },
    ],
    usage_metadata: {
      input_tokens: input,
      output_tokens: 100,
      total_tokens: input + 100,
    },
  });
}

/** Three finished client turns and a new question. */
function longThread(lastInput = 10_000): BaseMessage[] {
  return [
    new HumanMessage({ id: "h1", content: "first question" }),
    new AIMessage({
      id: "a1",
      content: "",
      tool_calls: [{ id: "c1", name: "search", args: { q: "flutch" } }],
    }),
    new ToolMessage({
      id: "t1",
      tool_call_id: "c1",
      name: "search",
      content: big(9_000),
    }),
    Object.assign(answered(5_000), { id: "a1b" }),
    new HumanMessage({ id: "h2", content: "second question" }),
    Object.assign(answered(8_000), { id: "a2" }),
    new HumanMessage({ id: "h3", content: "third question" }),
    Object.assign(answered(lastInput), { id: "a3" }),
    new HumanMessage({ id: "h4", content: "fourth question" }),
  ];
}

function summarizer(text = "the summary"): SummaryModel & {
  calls: { input: BaseMessage[]; options: any }[];
} {
  const calls: { input: BaseMessage[]; options: any }[] = [];
  return {
    calls,
    invoke: async (input, options) => {
      calls.push({ input, options });
      return new AIMessage(text);
    },
  };
}

describe("resolveAutoCompactSettings", () => {
  it("is off when unset, false, or not enabled", () => {
    expect(resolveAutoCompactSettings(undefined)).toBeNull();
    expect(resolveAutoCompactSettings(false)).toBeNull();
    expect(resolveAutoCompactSettings({ triggerTokens: 50_000 })).toBeNull();
  });

  it("takes true as on with the defaults", () => {
    expect(resolveAutoCompactSettings(true)).toEqual({
      triggerTokens: 100_000,
      keepRecentTurns: 1,
    });
  });

  it("reads the fields given as strings, and keeps the trigger above its floor", () => {
    expect(
      resolveAutoCompactSettings({
        enabled: "true",
        triggerTokens: "60000",
        keepRecentTurns: "0",
        modelId: " m1 ",
        instructions: " order ids ",
      })
    ).toEqual({
      triggerTokens: 60_000,
      keepRecentTurns: 0,
      modelId: "m1",
      instructions: "order ids",
    });
    expect(
      resolveAutoCompactSettings({ enabled: true, triggerTokens: 10 })
        ?.triggerTokens
    ).toBe(4_000);
  });
});

describe("contextTokens", () => {
  it("counts from the last reported call plus what came after it", () => {
    const messages = [
      new HumanMessage("q"),
      answered(20_000),
      new HumanMessage(big(300)),
    ];
    expect(contextTokens(messages)).toBe(20_000 + 100 + 100);
  });

  it("estimates the whole history when no call was reported", () => {
    expect(contextTokens([new HumanMessage(big(3_000))])).toBe(1_000);
  });
});

describe("planCompaction", () => {
  it("is nothing below the threshold", () => {
    expect(planCompaction(longThread(1_000), settings())).toBeNull();
  });

  it("is nothing in the middle of a tool round", () => {
    const messages = longThread().slice(0, 3);
    expect(planCompaction(messages, settings({ triggerTokens: 1 }))).toBeNull();
  });

  it("keeps the previous turn and the current one", () => {
    const plan = planCompaction(longThread(), settings());
    expect(plan?.head.map(m => m.id)).toEqual([
      "h1",
      "a1",
      "t1",
      "a1b",
      "h2",
      "a2",
    ]);
    expect(plan?.tail.map(m => m.id)).toEqual(["h3", "a3", "h4"]);
  });

  it("keeps only the current turn when keepRecentTurns is 0", () => {
    const plan = planCompaction(longThread(), settings({ keepRecentTurns: 0 }));
    expect(plan?.tail.map(m => m.id)).toEqual(["h4"]);
  });

  it("is nothing when there is no turn older than the kept ones", () => {
    const messages = [
      new HumanMessage("q"),
      answered(50_000),
      new HumanMessage("q2"),
    ];
    expect(
      planCompaction(messages, settings({ keepRecentTurns: 1 }))
    ).toBeNull();
  });
});

describe("hidden messages", () => {
  const hidden = (m: BaseMessage) =>
    m.additional_kwargs?.suppressFromLlm === true;
  const signal = (id: string) =>
    new HumanMessage({
      id,
      content: "order paid",
      additional_kwargs: { suppressFromLlm: true },
    });

  it("does not count a hidden message as a client turn", () => {
    const messages = longThread();
    messages.splice(6, 0, signal("s1"));
    const plan = planCompaction(messages, settings(), { isHidden: hidden });
    expect(plan?.tail.map(m => m.id)).toEqual(["h3", "a3", "h4"]);
  });

  it("starts a turn at a client message that follows a hidden one", () => {
    const messages = longThread();
    messages.splice(8, 0, signal("s2"));
    const plan = planCompaction(messages, settings({ keepRecentTurns: 0 }), {
      isHidden: hidden,
    });
    expect(plan?.tail.map(m => m.id)).toEqual(["h4"]);
  });

  it("leaves hidden messages out of the summary", async () => {
    const model = summarizer();
    const messages = longThread();
    messages.splice(1, 0, signal("s3"));
    await autoCompact(messages, {
      settings: settings(),
      model,
      isHidden: hidden,
    });
    expect(String(model.calls[0].input[1].content)).not.toContain("order paid");
  });
});

describe("graph notes", () => {
  it("summarises a note but starts no turn at it", async () => {
    const note = new HumanMessage({
      id: "n1",
      content: "background research finished: 12 partners",
      additional_kwargs: { backgroundResults: true },
    });
    const messages = longThread();
    messages.splice(8, 0, note);
    const isClientMessage = (m: BaseMessage) =>
      !m.additional_kwargs?.backgroundResults;
    const plan = planCompaction(messages, settings({ keepRecentTurns: 0 }), {
      isClientMessage,
    });
    expect(plan?.tail.map(m => m.id)).toEqual(["h4"]);
    expect(renderTranscript(plan!.head, { isClientMessage })).toContain(
      "Note to the assistant: background research finished: 12 partners"
    );
  });
});

describe("renderTranscript", () => {
  it("writes turns as text with tool calls and cut results, without thinking", () => {
    const text = renderTranscript(longThread().slice(0, 4));
    expect(text).toContain("User: first question");
    expect(text).toContain('Assistant called search({"q":"flutch"})');
    expect(text).toContain("Result of search:");
    expect(text).toContain("characters cut");
    expect(text).toContain("Assistant: answer");
    expect(text).not.toContain("let me think");
  });
});

describe("autoCompact", () => {
  it("does nothing when off", async () => {
    const model = summarizer();
    expect(
      await autoCompact(longThread(), { settings: null, model })
    ).toBeNull();
    expect(model.calls).toHaveLength(0);
  });

  it("replaces the earlier turns with the summary and keeps the latest without thinking", async () => {
    const model = summarizer("User wants X; order 42");
    const messages = longThread();
    const result = await autoCompact(messages, {
      settings: settings(),
      model,
      config: { tags: ["graph"], metadata: { stream_channel: "text" } },
    });

    expect(result?.summarizedMessages).toBe(6);
    expect(result?.messages.map(m => m.id).slice(1)).toEqual([
      "h3",
      "a3",
      "h4",
    ]);
    expect(isCompactSummary(result!.messages[0])).toBe(true);
    expect(String(result!.messages[0].content)).toContain("order 42");

    const keptAnswer = result!.messages[2] as AIMessage;
    expect(keptAnswer.content).toEqual([{ type: "text", text: "answer" }]);
    expect(keptAnswer.usage_metadata).toBeUndefined();

    const call = model.calls[0];
    expect(call.options.tags).toEqual(["graph", "nostream", "auto_compact"]);
    expect(call.options.runName).toBe("auto_compact");
    expect(String(call.input[1].content)).toContain("User: first question");
    expect(String(call.input[1].content)).not.toContain("fourth question");
  });

  it("gives a state update the messages reducer turns into the compacted history", async () => {
    const messages = longThread();
    const result = await autoCompact(messages, {
      settings: settings(),
      model: summarizer(),
    });
    const stored = messagesStateReducer(messages, [
      ...result!.stateUpdate,
      new AIMessage({ id: "a4", content: "fourth answer" }),
    ]);
    expect(stored.map(m => m.id).slice(1)).toEqual(["h3", "a3", "h4", "a4"]);
    expect(result!.stateUpdate[0]).toBeInstanceOf(RemoveMessage);
    expect(result!.stateUpdate[0].id).toBe(REMOVE_ALL_MESSAGES);
  });

  it("does not compact again on the next turn from the kept turns' old usage", async () => {
    const result = await autoCompact(longThread(), {
      settings: settings(),
      model: summarizer(),
    });
    const next = [...result!.messages, new HumanMessage("fifth question")];
    expect(planCompaction(next, settings())).toBeNull();
  });

  it("folds an earlier summary into the next one", async () => {
    const first = await autoCompact(longThread(), {
      settings: settings(),
      model: summarizer("first summary"),
    });
    const model = summarizer("second summary");
    const next = [
      ...first!.messages,
      answered(9_000),
      new HumanMessage("q5"),
      answered(9_000),
      new HumanMessage("q6"),
    ];
    const second = await autoCompact(next, { settings: settings(), model });
    expect(second).not.toBeNull();
    expect(String(model.calls[0].input[1].content)).toContain(
      "[Summary of the conversation before this point]\nfirst summary"
    );
    expect(second!.messages.filter(isCompactSummary)).toHaveLength(1);
  });

  it("leaves the history as it is when the summarizer fails or returns nothing", async () => {
    const errors: unknown[] = [];
    const failing: SummaryModel = {
      invoke: async () => {
        throw new Error("down");
      },
    };
    expect(
      await autoCompact(longThread(), {
        settings: settings(),
        model: failing,
        onError: e => errors.push(e),
      })
    ).toBeNull();
    expect(errors).toHaveLength(1);
    expect(
      await autoCompact(longThread(), {
        settings: settings(),
        model: summarizer("  "),
      })
    ).toBeNull();
  });

  it("resolves the summarizer lazily, only when compacting", async () => {
    let resolved = 0;
    const model = () => {
      resolved += 1;
      return Promise.resolve(summarizer());
    };
    await autoCompact(longThread(1_000), { settings: settings(), model });
    expect(resolved).toBe(0);
    await autoCompact(longThread(), { settings: settings(), model });
    expect(resolved).toBe(1);
  });
});
