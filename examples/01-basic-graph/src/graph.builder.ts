import { Injectable } from "@nestjs/common";
import {
  ExternalGraphBuilder,
  IGraphRequestPayload,
} from "@flutchai/flutch-sdk";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";

/**
 * Define the state schema for our graph using Annotation
 */
const GraphState = Annotation.Root({
  // Input message from user
  input: Annotation<string>(),
  // Processed result
  result: Annotation<string>(),
});

type GraphStateType = typeof GraphState.State;

/**
 * Simple graph builder that echoes back the user's message
 * This is the most basic example of using the Flutch SDK
 */
@Injectable()
export class BasicGraphBuilder extends ExternalGraphBuilder<"1.0.0"> {
  readonly version = "1.0.0" as const;

  async buildGraph(payload: IGraphRequestPayload): Promise<any> {
    // Create a simple graph that processes the input
    const graph = new StateGraph(GraphState)
      // Add a node that processes the message
      .addNode("process", async (state: GraphStateType) => {
        // Simple processing - just format the response
        const result = `Hello! You said: "${state.input}"`;
        return { result };
      })
      // Connect the nodes
      .addEdge(START, "process")
      .addEdge("process", END);

    // Compile the graph
    const compiled = graph.compile();

    return compiled;
  }

  /**
   * Prepare the configuration for graph execution
   */
  async prepareConfig(payload: IGraphRequestPayload): Promise<any> {
    // Get base config from parent
    const baseConfig = await super.prepareConfig(payload);

    // Extract the message content
    const messageContent = payload.message?.content || "";
    const input =
      typeof messageContent === "string"
        ? messageContent
        : JSON.stringify(messageContent);

    return {
      ...baseConfig,
      // Add initial state
      input: { input },
    };
  }
}
