import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import {
  Command,
  END,
  interrupt,
  MemorySaver,
  MessagesAnnotation,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { isCompactSummary, SummaryModel } from "../messages/auto-compact";
import {
  compactThreadInput,
  threadCompactSettingsOf,
} from "../graph/thread-compaction";
import { LangGraphEngine } from "../engines/langgraph/langgraph-engine";
import { EventProcessor } from "../engines/langgraph/event-processor.utils";
import { ModelInitializer } from "../models/model.initializer";

jest.mock("@langchain/mistralai", () => ({ ChatMistralAI: jest.fn() }));

/** A graph whose every answer reports a context of `inputTokens` — what the threshold reads. */
function chatGraph(inputTokens = 10_000) {
  return new StateGraph(MessagesAnnotation)
    .addNode("answer", async state => ({
      messages: [
        new AIMessage({
          content: `answer ${state.messages.length}`,
          usage_metadata: {
            input_tokens: inputTokens,
            output_tokens: 10,
            total_tokens: inputTokens + 10,
          },
        }),
      ],
    }))
    .addEdge(START, "answer")
    .addEdge("answer", END)
    .compile({ checkpointer: new MemorySaver() });
}

/** The config the SDK runs a root graph with: its own checkpoint_ns and checkpoint_id. */
const runConfig = (autoCompact?: unknown) => ({
  configurable: {
    thread_id: "t1",
    checkpoint_ns: "simple",
    checkpoint_id: "t1",
    graphSettings: { modelId: "agent-model" },
    ...(autoCompact === undefined ? {} : { threadSettings: { autoCompact } }),
  },
});

/** The thread's latest state: the root graph's checkpoints sit under the default namespace. */
const stateOf = { configurable: { thread_id: "t1" } };

const turn = (text: string) => ({ messages: [new HumanMessage(text)] });

function summarizer(text = "the summary") {
  const calls: BaseMessage[][] = [];
  const model: SummaryModel = {
    invoke: async input => {
      calls.push(input);
      return new AIMessage(text);
    },
  };
  return { model, calls, models: [] as string[] };
}

async function threadOfTurns(graph: ReturnType<typeof chatGraph>, n: number) {
  for (let i = 1; i <= n; i++)
    await graph.invoke(turn(`question ${i}`), runConfig());
}

const on = { enabled: true, triggerTokens: 4_000, keepRecentTurns: 1 };

describe("compactThreadInput", () => {
  it("rewrites the history in the same write that adds the new turn", async () => {
    const graph = chatGraph();
    await threadOfTurns(graph, 3);
    const { model, calls } = summarizer();
    const models: string[] = [];

    const compacted = await compactThreadInput(
      graph,
      turn("question 4"),
      runConfig(on),
      {
        settings: on,
        createModel: async id => {
          models.push(id);
          return model;
        },
      }
    );

    expect(compacted).not.toBeNull();
    expect(models).toEqual(["agent-model"]);
    expect(String(calls[0][1].content)).toContain("question 1");
    expect(String(calls[0][1].content)).not.toContain("question 4");

    await graph.invoke(compacted!.input, runConfig(on));
    const messages = (await graph.getState(stateOf)).values
      .messages as BaseMessage[];
    expect(isCompactSummary(messages[0])).toBe(true);
    expect(messages.slice(1).map(m => String(m.content))).toEqual([
      "question 3",
      "answer 5",
      "question 4",
      "answer 4",
    ]);
  });

  it("is off without the agent's setting, below the threshold, and for a graph without a history", async () => {
    const graph = chatGraph(1_000);
    await threadOfTurns(graph, 3);
    const { model, calls } = summarizer();
    const createModel = async () => model;

    expect(
      await compactThreadInput(graph, turn("q"), runConfig(), {
        settings: undefined,
        createModel,
      })
    ).toBeNull();
    expect(
      await compactThreadInput(graph, turn("q"), runConfig(on), {
        settings: on,
        createModel,
      })
    ).toBeNull();
    expect(
      await compactThreadInput({}, turn("q"), runConfig(on), {
        settings: on,
        createModel,
      })
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("leaves a resumed run alone", async () => {
    const graph = chatGraph();
    await threadOfTurns(graph, 3);
    const { model, calls } = summarizer();

    expect(
      await compactThreadInput(
        graph,
        new Command({ resume: "yes" }),
        runConfig(on),
        { settings: on, createModel: async () => model }
      )
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("leaves a thread parked on an interrupt alone", async () => {
    const graph = new StateGraph(MessagesAnnotation)
      .addNode("answer", async () => ({
        messages: [
          new AIMessage({
            content: "answer",
            usage_metadata: {
              input_tokens: 10_000,
              output_tokens: 10,
              total_tokens: 10_010,
            },
          }),
        ],
      }))
      .addNode("approve", async () => {
        interrupt("approve?");
        return {};
      })
      .addEdge(START, "answer")
      .addEdge("answer", "approve")
      .addEdge("approve", END)
      .compile({ checkpointer: new MemorySaver() });
    await graph.invoke(turn("question 1"), runConfig());
    const { model, calls } = summarizer();

    expect(
      await compactThreadInput(graph, turn("question 2"), runConfig(on), {
        settings: on,
        createModel: async () => model,
      })
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("starts below the graph's own ceiling and adds the graph's instructions", async () => {
    const graph = chatGraph(5_000);
    await threadOfTurns(graph, 3);
    const { model, calls } = summarizer();
    const settings = { ...on, triggerTokens: 50_000, instructions: "prices" };

    const compacted = await compactThreadInput(
      graph,
      turn("question 4"),
      runConfig(settings),
      {
        settings,
        maxTriggerTokens: 4_500,
        instructions: "every id",
        createModel: async () => model,
      }
    );

    expect(compacted).not.toBeNull();
    const system = String(calls[0][0].content);
    expect(system).toContain("every id");
    expect(system).toContain("prices");
  });

  it("keeps the history when the summary fails", async () => {
    const graph = chatGraph();
    await threadOfTurns(graph, 3);
    const errors: unknown[] = [];

    expect(
      await compactThreadInput(graph, turn("question 4"), runConfig(on), {
        settings: on,
        createModel: async () => {
          throw new Error("router down");
        },
        onError: error => errors.push(error),
      })
    ).toBeNull();
    expect(errors).toHaveLength(1);
  });

  it("reads the setting from the run's threadSettings", () => {
    expect(threadCompactSettingsOf(runConfig(on))).toEqual(on);
    expect(threadCompactSettingsOf(runConfig())).toBeUndefined();
  });
});

describe("LangGraphEngine auto-compaction", () => {
  afterEach(() => jest.restoreAllMocks());

  const engine = () => new LangGraphEngine(new EventProcessor());

  it("compacts the thread before the run when the graph takes part", async () => {
    const graph = chatGraph();
    await threadOfTurns(graph, 3);
    const init = jest
      .spyOn(ModelInitializer.prototype, "initializeChatModel")
      .mockResolvedValue(new FakeListChatModel({ responses: ["summary"] }));

    await engine().invokeGraph(
      graph,
      { input: turn("question 4"), config: runConfig(on) },
      undefined,
      { compaction: {} }
    );

    expect(init).toHaveBeenCalledWith({
      modelId: "agent-model",
      maxTokens: 8000,
    });
    const messages = (await graph.getState(stateOf)).values
      .messages as BaseMessage[];
    expect(isCompactSummary(messages[0])).toBe(true);
    expect(String(messages[messages.length - 2].content)).toBe("question 4");
  });

  it("runs the graph as it is when the graph opts out", async () => {
    const graph = chatGraph();
    await threadOfTurns(graph, 3);
    const init = jest.spyOn(ModelInitializer.prototype, "initializeChatModel");

    await engine().invokeGraph(
      graph,
      { input: turn("question 4"), config: runConfig(on) },
      undefined,
      { compaction: null }
    );

    expect(init).not.toHaveBeenCalled();
    const messages = (await graph.getState(stateOf)).values
      .messages as BaseMessage[];
    expect(messages).toHaveLength(8);
  });

  it("goes on with the whole history when the summary fails", async () => {
    const graph = chatGraph();
    await threadOfTurns(graph, 3);
    jest
      .spyOn(ModelInitializer.prototype, "initializeChatModel")
      .mockRejectedValue(new Error("router down"));

    await engine().invokeGraph(
      graph,
      { input: turn("question 4"), config: runConfig(on) },
      undefined,
      { compaction: {} }
    );

    const messages = (await graph.getState(stateOf)).values
      .messages as BaseMessage[];
    expect(messages).toHaveLength(8);
    expect(messages.some(isCompactSummary)).toBe(false);
  });
});
