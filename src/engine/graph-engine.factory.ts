// packages/sdk/src/graph-engine.factory.ts
import { Inject, Injectable } from "@nestjs/common";
import { IGraphEngine } from "../core/abstract-graph.builder";
import { LangGraphEngine } from "./langgraph-engine";

/**
 * Graph engine type
 */
export enum GraphEngineType {
  LANGGRAPH = "langgraph",
  LANGFLOW = "langflow",
  FLOWISE = "flowise",
}

/**
 * Factory for creating graph engines
 */
@Injectable()
export class GraphEngineFactory {
  constructor(
    @Inject()
    private readonly langgraph: LangGraphEngine
  ) {}
  /**
   * Get engine for the specified type
   */
  getEngine(engineType: GraphEngineType): IGraphEngine {
    switch (engineType) {
      case GraphEngineType.LANGGRAPH:
        return this.langgraph;
      // Will add other types in the future
      // case GraphEngineType.LANGFLOW:
      //   return new LangFlowEngine();
      // case GraphEngineType.FLOWISE:
      //   return new FlowiseEngine();
      default:
        throw new Error(`Unsupported graph engine type: ${engineType}`);
    }
  }
}
