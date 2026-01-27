import {
  EventProcessor,
  StreamAccumulator,
} from "../engines/langgraph/event-processor.utils";
import { StreamChannel } from "../messages";

describe("EventProcessor", () => {
  let processor: EventProcessor;

  beforeEach(() => {
    processor = new EventProcessor();
  });

  function createAccumulator(): StreamAccumulator {
    return processor.createAccumulator();
  }

  // Helper to build LangGraph events
  function chatModelStreamEvent(
    content: any,
    channel: StreamChannel = StreamChannel.TEXT
  ) {
    return {
      event: "on_chat_model_stream",
      data: { chunk: { content } },
      metadata: { stream_channel: channel, langgraph_node: "agent" },
    };
  }

  function toolStartEvent(
    name: string,
    runId: string,
    channel: StreamChannel = StreamChannel.TEXT
  ) {
    return {
      event: "on_tool_start",
      name,
      run_id: runId,
      data: { input: {} },
      metadata: { stream_channel: channel, langgraph_node: "agent" },
    };
  }

  function toolEndEvent(
    name: string,
    runId: string,
    output: any,
    channel: StreamChannel = StreamChannel.TEXT
  ) {
    return {
      event: "on_tool_end",
      name,
      run_id: runId,
      data: { output },
      metadata: { stream_channel: channel, langgraph_node: "agent" },
    };
  }

  function toolErrorEvent(
    name: string,
    runId: string,
    error: string,
    channel: StreamChannel = StreamChannel.TEXT
  ) {
    return {
      event: "on_tool_error",
      name,
      run_id: runId,
      data: { error },
      metadata: { stream_channel: channel, langgraph_node: "agent" },
    };
  }

  describe("createAccumulator", () => {
    it("should create accumulator with TEXT and PROCESSING channels", () => {
      const acc = createAccumulator();

      expect(acc.channels.size).toBe(2);
      expect(acc.channels.has(StreamChannel.TEXT)).toBe(true);
      expect(acc.channels.has(StreamChannel.PROCESSING)).toBe(true);
    });

    it("should initialize channel state with empty pendingToolBlocks", () => {
      const acc = createAccumulator();
      const textState = acc.channels.get(StreamChannel.TEXT)!;

      expect(textState.contentChain).toEqual([]);
      expect(textState.currentBlock).toBeNull();
      expect(textState.pendingToolBlocks).toEqual([]);
    });
  });

  describe("processEvent - text streaming", () => {
    it("should accumulate text blocks", () => {
      const acc = createAccumulator();

      processor.processEvent(
        acc,
        chatModelStreamEvent([{ type: "text", text: "Hello " }])
      );
      processor.processEvent(
        acc,
        chatModelStreamEvent([{ type: "text", text: "world" }])
      );

      const state = acc.channels.get(StreamChannel.TEXT)!;
      expect(state.currentBlock).toEqual(
        expect.objectContaining({ type: "text", text: "Hello world" })
      );
    });

    it("should send text_chunk deltas via onPartial", () => {
      const acc = createAccumulator();
      const onPartial = jest.fn();

      processor.processEvent(
        acc,
        chatModelStreamEvent([{ type: "text", text: "Hi" }]),
        onPartial
      );

      expect(onPartial).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(onPartial.mock.calls[0][0]);
      expect(parsed.delta.type).toBe("text_chunk");
      expect(parsed.delta.text).toBe("Hi");
    });
  });

  describe("processEvent - single tool lifecycle", () => {
    it("should create tool_use block and track in pendingToolBlocks", () => {
      const acc = createAccumulator();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: "" },
        ])
      );

      const state = acc.channels.get(StreamChannel.TEXT)!;
      expect(state.currentBlock).toEqual(
        expect.objectContaining({
          type: "tool_use",
          id: "toolu_1",
          name: "get_weather",
        })
      );
      expect(state.pendingToolBlocks).toHaveLength(1);
      expect(state.pendingToolBlocks[0].id).toBe("toolu_1");
    });

    it("should accumulate tool input via input_json_delta", () => {
      const acc = createAccumulator();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: "" },
        ])
      );
      processor.processEvent(
        acc,
        chatModelStreamEvent([{ type: "input_json_delta", input: '{"city":' }])
      );
      processor.processEvent(
        acc,
        chatModelStreamEvent([{ type: "input_json_delta", input: '"London"}' }])
      );

      const state = acc.channels.get(StreamChannel.TEXT)!;
      expect(state.currentBlock!.input).toBe('{"city":"London"}');
    });

    it("should assign output to correct tool block on on_tool_end", () => {
      const acc = createAccumulator();

      // Stream tool block
      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: "" },
        ])
      );

      // Tool lifecycle
      processor.processEvent(acc, toolStartEvent("get_weather", "run-1"));
      processor.processEvent(
        acc,
        toolEndEvent("get_weather", "run-1", "Sunny, 22°C")
      );

      const state = acc.channels.get(StreamChannel.TEXT)!;
      // The tool block (either in pendingToolBlocks or currentBlock) should have output
      // After on_tool_end with FIFO, pendingToolBlocks is drained
      expect(state.pendingToolBlocks).toHaveLength(0);
    });

    it("should send step_started delta when tool block is created", () => {
      const acc = createAccumulator();
      const onPartial = jest.fn();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: "" },
        ]),
        onPartial
      );

      const parsed = JSON.parse(onPartial.mock.calls[0][0]);
      expect(parsed.delta.type).toBe("step_started");
      expect(parsed.delta.step.name).toBe("get_weather");
      expect(parsed.delta.step.id).toBe("toolu_1");
    });

    it("should send tool_output_chunk delta on on_tool_end", () => {
      const acc = createAccumulator();
      const onPartial = jest.fn();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: "" },
        ]),
        onPartial
      );

      processor.processEvent(acc, toolStartEvent("get_weather", "run-1"));
      processor.processEvent(
        acc,
        toolEndEvent("get_weather", "run-1", "Sunny"),
        onPartial
      );

      // Find the tool_output_chunk delta
      const outputCall = onPartial.mock.calls.find((call: any[]) => {
        const parsed = JSON.parse(call[0]);
        return parsed.delta.type === "tool_output_chunk";
      });
      expect(outputCall).toBeDefined();

      const parsed = JSON.parse(outputCall![0]);
      expect(parsed.delta.stepId).toBe("toolu_1");
      expect(parsed.delta.chunk).toBe("Sunny");
    });
  });

  describe("processEvent - multiple sequential tools", () => {
    it("should assign outputs to correct tool blocks in sequence", () => {
      const acc = createAccumulator();

      // LLM streams two tool calls
      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: "" },
        ])
      );
      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_2", name: "get_time", input: "" },
        ])
      );

      const state = acc.channels.get(StreamChannel.TEXT)!;
      expect(state.pendingToolBlocks).toHaveLength(2);

      // Tools execute sequentially
      processor.processEvent(acc, toolStartEvent("get_weather", "run-1"));
      processor.processEvent(
        acc,
        toolEndEvent("get_weather", "run-1", "Sunny")
      );

      processor.processEvent(acc, toolStartEvent("get_time", "run-2"));
      processor.processEvent(acc, toolEndEvent("get_time", "run-2", "14:30"));

      // Both tool blocks should have correct outputs
      expect(state.pendingToolBlocks).toHaveLength(0);

      // First tool is in contentChain (was finalized when second tool started)
      const weatherBlock = state.contentChain.find(b => b.id === "toolu_1");
      expect(weatherBlock).toBeDefined();
      expect(weatherBlock!.output).toBe("Sunny");

      // Second tool is currentBlock
      expect(state.currentBlock!.id).toBe("toolu_2");
      expect(state.currentBlock!.output).toBe("14:30");
    });

    it("should send tool_output_chunk with correct stepId for each tool", () => {
      const acc = createAccumulator();
      const onPartial = jest.fn();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "search", input: "" },
        ]),
        onPartial
      );
      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_2", name: "calculate", input: "" },
        ]),
        onPartial
      );

      processor.processEvent(acc, toolStartEvent("search", "run-1"));
      processor.processEvent(
        acc,
        toolEndEvent("search", "run-1", "result-1"),
        onPartial
      );

      processor.processEvent(acc, toolStartEvent("calculate", "run-2"));
      processor.processEvent(
        acc,
        toolEndEvent("calculate", "run-2", "result-2"),
        onPartial
      );

      const outputDeltas = onPartial.mock.calls
        .map((call: any[]) => JSON.parse(call[0]))
        .filter((parsed: any) => parsed.delta.type === "tool_output_chunk");

      expect(outputDeltas).toHaveLength(2);
      expect(outputDeltas[0].delta.stepId).toBe("toolu_1");
      expect(outputDeltas[0].delta.chunk).toBe("result-1");
      expect(outputDeltas[1].delta.stepId).toBe("toolu_2");
      expect(outputDeltas[1].delta.chunk).toBe("result-2");
    });
  });

  describe("processEvent - tool after text block", () => {
    it("should finalize text block before creating tool block", () => {
      const acc = createAccumulator();

      // Text first
      processor.processEvent(
        acc,
        chatModelStreamEvent([{ type: "text", text: "Let me check " }])
      );

      // Then tool
      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "search", input: "" },
        ])
      );

      const state = acc.channels.get(StreamChannel.TEXT)!;
      // Text block should be in contentChain
      expect(state.contentChain).toHaveLength(1);
      expect(state.contentChain[0].type).toBe("text");
      expect(state.contentChain[0].text).toBe("Let me check ");

      // Current block is tool
      expect(state.currentBlock!.type).toBe("tool_use");
    });
  });

  describe("processEvent - on_tool_end without pending block", () => {
    it("should not throw when no pending tool blocks exist", () => {
      const acc = createAccumulator();

      // on_tool_end without any tool block created
      expect(() => {
        processor.processEvent(
          acc,
          toolEndEvent("unknown_tool", "run-1", "output")
        );
      }).not.toThrow();
    });
  });

  describe("processEvent - on_tool_error", () => {
    it("should log error without crashing", () => {
      const acc = createAccumulator();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "failing_tool", input: "" },
        ])
      );

      expect(() => {
        processor.processEvent(
          acc,
          toolErrorEvent("failing_tool", "run-1", "Connection timeout")
        );
      }).not.toThrow();
    });
  });

  describe("processEvent - JSON output serialization", () => {
    it("should serialize object output to JSON string", () => {
      const acc = createAccumulator();
      const onPartial = jest.fn();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "get_data", input: "" },
        ])
      );

      const objectOutput = { temperature: 22, unit: "celsius" };
      processor.processEvent(acc, toolStartEvent("get_data", "run-1"));
      processor.processEvent(
        acc,
        toolEndEvent("get_data", "run-1", objectOutput),
        onPartial
      );

      const outputDelta = onPartial.mock.calls
        .map((call: any[]) => JSON.parse(call[0]))
        .find((p: any) => p.delta.type === "tool_output_chunk");

      expect(outputDelta.delta.chunk).toBe(
        JSON.stringify(objectOutput, null, 2)
      );
    });

    it("should keep string output as-is", () => {
      const acc = createAccumulator();
      const onPartial = jest.fn();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "search", input: "" },
        ])
      );

      processor.processEvent(acc, toolStartEvent("search", "run-1"));
      processor.processEvent(
        acc,
        toolEndEvent("search", "run-1", "plain text result"),
        onPartial
      );

      const outputDelta = onPartial.mock.calls
        .map((call: any[]) => JSON.parse(call[0]))
        .find((p: any) => p.delta.type === "tool_output_chunk");

      expect(outputDelta.delta.chunk).toBe("plain text result");
    });
  });

  describe("processEvent - channel routing", () => {
    it("should route events to PROCESSING channel when specified", () => {
      const acc = createAccumulator();

      processor.processEvent(
        acc,
        chatModelStreamEvent(
          [{ type: "tool_use", id: "toolu_p1", name: "think", input: "" }],
          StreamChannel.PROCESSING
        )
      );

      const processingState = acc.channels.get(StreamChannel.PROCESSING)!;
      const textState = acc.channels.get(StreamChannel.TEXT)!;

      expect(processingState.currentBlock!.id).toBe("toolu_p1");
      expect(processingState.pendingToolBlocks).toHaveLength(1);
      expect(textState.currentBlock).toBeNull();
      expect(textState.pendingToolBlocks).toHaveLength(0);
    });
  });

  describe("getResult", () => {
    it("should finalize currentBlock into contentChain", () => {
      const acc = createAccumulator();

      processor.processEvent(
        acc,
        chatModelStreamEvent([{ type: "text", text: "Final text" }])
      );

      const result = processor.getResult(acc);
      const textChain = result.content.contentChains?.find(
        c => c.channel === "text"
      );

      expect(textChain).toBeDefined();
      expect(textChain!.steps).toHaveLength(1);
      expect(textChain!.steps[0].text).toBe("Final text");
    });

    it("should include tool blocks with outputs in final result", () => {
      const acc = createAccumulator();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "search", input: "" },
        ])
      );
      processor.processEvent(acc, toolStartEvent("search", "run-1"));
      processor.processEvent(acc, toolEndEvent("search", "run-1", "found it"));

      const result = processor.getResult(acc);
      const textChain = result.content.contentChains?.find(
        c => c.channel === "text"
      );

      expect(textChain!.steps).toHaveLength(1);
      expect(textChain!.steps[0].type).toBe("tool_use");
      expect(textChain!.steps[0].output).toBe("found it");
    });

    it("should extract text for backwards compatibility", () => {
      const acc = createAccumulator();

      processor.processEvent(
        acc,
        chatModelStreamEvent([{ type: "text", text: "Hello " }])
      );
      processor.processEvent(
        acc,
        chatModelStreamEvent([{ type: "text", text: "world" }])
      );

      const result = processor.getResult(acc);
      expect(result.content.text).toBe("Hello world");
    });

    it("should return empty text when no text blocks exist", () => {
      const acc = createAccumulator();

      processor.processEvent(
        acc,
        chatModelStreamEvent([
          { type: "tool_use", id: "toolu_1", name: "search", input: "" },
        ])
      );

      const result = processor.getResult(acc);
      expect(result.content.text).toBe("");
    });
  });
});
