import { BuilderRegistryService } from "../core/builder-registry.service";

describe("BuilderRegistryService", () => {
  let registry: BuilderRegistryService;

  beforeEach(() => {
    registry = new BuilderRegistryService();
  });

  const mockBuilder = (graphType: string) => ({ graphType }) as any;

  describe("registerBuilder", () => {
    it("should register a builder", () => {
      registry.registerBuilder(mockBuilder("chat"));
      expect(registry.getBuilders()).toHaveLength(1);
      expect(registry.getBuilders()[0].graphType).toBe("chat");
    });

    it("should not register duplicate graphType", () => {
      registry.registerBuilder(mockBuilder("chat"));
      registry.registerBuilder(mockBuilder("chat"));
      expect(registry.getBuilders()).toHaveLength(1);
    });

    it("should register multiple different builders", () => {
      registry.registerBuilder(mockBuilder("chat"));
      registry.registerBuilder(mockBuilder("rag"));
      expect(registry.getBuilders()).toHaveLength(2);
    });
  });

  describe("getBuilders", () => {
    it("should return empty array when no builders registered", () => {
      expect(registry.getBuilders()).toEqual([]);
    });
  });
});
