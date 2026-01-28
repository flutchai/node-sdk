import {
  GraphEngineFactory,
  GraphEngineType,
} from "../engines/graph-engine.factory";

describe("GraphEngineFactory", () => {
  const mockLanggraph = { streamGraph: jest.fn(), invokeGraph: jest.fn() };
  let factory: GraphEngineFactory;

  beforeEach(() => {
    factory = new GraphEngineFactory(mockLanggraph as any);
  });

  it("should return LangGraphEngine for LANGGRAPH type", () => {
    const engine = factory.getEngine(GraphEngineType.LANGGRAPH);
    expect(engine).toBe(mockLanggraph);
  });

  it("should throw for unsupported engine type", () => {
    expect(() => factory.getEngine("custom" as any)).toThrow(
      "Unsupported graph engine type: custom"
    );
  });

  it("should throw for LANGFLOW type (not yet implemented)", () => {
    expect(() => factory.getEngine(GraphEngineType.LANGFLOW)).toThrow(
      "Unsupported graph engine type: langflow"
    );
  });

  it("should throw for FLOWISE type (not yet implemented)", () => {
    expect(() => factory.getEngine(GraphEngineType.FLOWISE)).toThrow(
      "Unsupported graph engine type: flowise"
    );
  });
});
