import { EndpointRegistry } from "../agent-ui/endpoint.registry";

describe("EndpointRegistry", () => {
  let registry: EndpointRegistry;

  beforeEach(() => {
    registry = new EndpointRegistry();
  });

  const mockEndpoint = (name: string, method: "GET" | "POST" = "GET") => ({
    name,
    method,
    handler: jest.fn().mockResolvedValue({ schema: "test", data: {} }),
  });

  describe("register / get", () => {
    it("should register and retrieve an endpoint", () => {
      const ep = mockEndpoint("accounts.list");
      registry.register("ledger::1.0.0", ep);

      expect(registry.get("ledger::1.0.0", "accounts.list")).toBe(ep);
    });

    it("should return undefined for unregistered endpoint", () => {
      expect(registry.get("ledger::1.0.0", "nonexistent")).toBeUndefined();
    });

    it("should return undefined for unregistered graph type", () => {
      expect(registry.get("unknown", "accounts.list")).toBeUndefined();
    });
  });

  describe("registerMultiple", () => {
    it("should register multiple endpoints at once", () => {
      const eps = [mockEndpoint("list"), mockEndpoint("create", "POST")];
      registry.registerMultiple("chat::1.0.0", eps);

      expect(registry.get("chat::1.0.0", "list")).toBe(eps[0]);
      expect(registry.get("chat::1.0.0", "create")).toBe(eps[1]);
    });
  });

  describe("list / listEndpoints", () => {
    it("should list endpoint names for a graph type", () => {
      registry.register("chat", mockEndpoint("list"));
      registry.register("chat", mockEndpoint("create", "POST"));

      expect(registry.list("chat")).toEqual(["list", "create"]);
    });

    it("should return empty array for unknown graph type", () => {
      expect(registry.list("unknown")).toEqual([]);
    });

    it("listEndpoints should be an alias for list", () => {
      registry.register("chat", mockEndpoint("list"));
      expect(registry.listEndpoints("chat")).toEqual(registry.list("chat"));
    });
  });

  describe("listGraphTypes", () => {
    it("should list all registered graph types", () => {
      registry.register("chat", mockEndpoint("list"));
      registry.register("rag", mockEndpoint("search"));

      expect(registry.listGraphTypes()).toEqual(["chat", "rag"]);
    });

    it("should return empty when nothing registered", () => {
      expect(registry.listGraphTypes()).toEqual([]);
    });
  });

  describe("call", () => {
    it("should call the endpoint handler", async () => {
      const handler = jest
        .fn()
        .mockResolvedValue({ schema: "result", data: { items: [] } });
      registry.register("chat", { name: "list", method: "GET", handler });

      const ctx = {
        userId: "u1",
        method: "GET" as const,
        channel: "web",
      };
      const result = await registry.call("chat", "list", ctx);

      expect(handler).toHaveBeenCalledWith(ctx);
      expect(result).toEqual({ schema: "result", data: { items: [] } });
    });

    it("should throw when endpoint not found", async () => {
      const ctx = {
        userId: "u1",
        method: "GET" as const,
        channel: "web",
      };
      await expect(registry.call("chat", "missing", ctx)).rejects.toThrow(
        'Endpoint "missing" not found for graph "chat"'
      );
    });

    it("should throw when HTTP method mismatches", async () => {
      registry.register("chat", {
        name: "create",
        method: "POST",
        handler: jest.fn(),
      });

      const ctx = {
        userId: "u1",
        method: "GET" as const,
        channel: "web",
      };
      await expect(registry.call("chat", "create", ctx)).rejects.toThrow(
        "Method mismatch"
      );
    });

    it("should propagate handler errors", async () => {
      const handler = jest.fn().mockRejectedValue(new Error("handler failed"));
      registry.register("chat", { name: "action", method: "POST", handler });

      const ctx = {
        userId: "u1",
        method: "POST" as const,
        channel: "web",
      };
      await expect(registry.call("chat", "action", ctx)).rejects.toThrow(
        "handler failed"
      );
    });
  });

  describe("getStats", () => {
    it("should return stats about registered endpoints", () => {
      registry.register("chat", mockEndpoint("list"));
      registry.register("chat", mockEndpoint("create", "POST"));
      registry.register("rag", mockEndpoint("search"));

      const stats = registry.getStats();
      expect(stats.totalGraphTypes).toBe(2);
      expect(stats.totalEndpoints).toBe(3);
      expect(stats.endpointsByGraph).toEqual({ chat: 2, rag: 1 });
    });

    it("should return zeros when empty", () => {
      const stats = registry.getStats();
      expect(stats.totalGraphTypes).toBe(0);
      expect(stats.totalEndpoints).toBe(0);
    });
  });

  describe("clear / clearGraph", () => {
    it("should clear all endpoints", () => {
      registry.register("chat", mockEndpoint("list"));
      registry.register("rag", mockEndpoint("search"));
      registry.clear();

      expect(registry.listGraphTypes()).toEqual([]);
    });

    it("should clear endpoints for specific graph type", () => {
      registry.register("chat", mockEndpoint("list"));
      registry.register("rag", mockEndpoint("search"));
      registry.clearGraph("chat");

      expect(registry.listGraphTypes()).toEqual(["rag"]);
    });
  });
});
