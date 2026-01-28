import { CallbackRegistry } from "../callbacks/callback-registry";

describe("CallbackRegistry", () => {
  let registry: CallbackRegistry;

  beforeEach(() => {
    registry = new CallbackRegistry();
  });

  const mockHandler = jest.fn().mockResolvedValue({ action: "proceed" });
  const anotherHandler = jest.fn().mockResolvedValue({ action: "cancel" });

  describe("register", () => {
    it("should register a handler by name", () => {
      registry.register("confirm", mockHandler);
      expect(registry.get("confirm")).toBe(mockHandler);
    });

    it("should register with graphType as versioned key", () => {
      registry.register("confirm", mockHandler, "global.chat::1.0.0");
      expect(registry.get("confirm", "global.chat::1.0.0")).toBe(mockHandler);
    });

    it("should also register non-versioned fallback when graphType provided", () => {
      registry.register("confirm", mockHandler, "global.chat::1.0.0");
      // Should be accessible without graphType
      expect(registry.get("confirm")).toBe(mockHandler);
    });

    it("should overwrite existing handler with same key", () => {
      registry.register("confirm", mockHandler);
      registry.register("confirm", anotherHandler);
      expect(registry.get("confirm")).toBe(anotherHandler);
    });
  });

  describe("get", () => {
    it("should return undefined for unregistered handler", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("should prefer versioned handler over non-versioned", () => {
      const genericHandler = jest.fn();
      const versionedHandler = jest.fn();

      registry.register("confirm", genericHandler);
      registry.register("confirm", versionedHandler, "global.chat::2.0.0");

      // With graphType → versioned
      expect(registry.get("confirm", "global.chat::2.0.0")).toBe(
        versionedHandler
      );
    });

    it("should fall back to non-versioned when graphType has no match", () => {
      const genericHandler = jest.fn();
      registry.register("confirm", genericHandler);

      // Request with unknown graphType → falls back to generic
      expect(registry.get("confirm", "unknown.type::1.0.0")).toBe(
        genericHandler
      );
    });

    it("should return undefined when graphType has no match and no fallback", () => {
      expect(registry.get("confirm", "unknown.type::1.0.0")).toBeUndefined();
    });
  });

  describe("listHandlers", () => {
    it("should return empty array when no handlers registered", () => {
      expect(registry.listHandlers()).toEqual([]);
    });

    it("should list all registered handler keys", () => {
      registry.register("confirm", mockHandler);
      registry.register("reject", anotherHandler);

      const handlers = registry.listHandlers();
      expect(handlers).toContain("confirm");
      expect(handlers).toContain("reject");
    });

    it("should include both versioned and non-versioned keys", () => {
      registry.register("confirm", mockHandler, "global.chat::1.0.0");

      const handlers = registry.listHandlers();
      expect(handlers).toContain("global.chat::1.0.0::confirm");
      expect(handlers).toContain("confirm");
      expect(handlers).toHaveLength(2);
    });
  });
});
