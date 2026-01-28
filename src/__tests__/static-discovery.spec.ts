import { StaticDiscovery } from "../service-discovery/static.discovery";

describe("StaticDiscovery", () => {
  const testServices = [
    {
      name: "graph-a",
      address: "localhost",
      port: 3001,
      metadata: { version: "1.0" },
      category: "chat",
    },
    {
      name: "graph-b",
      address: "localhost",
      port: 3002,
      metadata: { version: "2.0", category: "rag" },
      category: "rag",
    },
    {
      name: "graph-c",
      address: "localhost",
      port: 3003,
      metadata: { category: "chat" },
    },
  ];

  describe("getServices", () => {
    it("should return services matching category", async () => {
      const discovery = new StaticDiscovery(testServices);
      const result = await discovery.getServices("chat");

      expect(result).toHaveLength(2);
      expect(result.map(s => s.name)).toContain("graph-a");
      expect(result.map(s => s.name)).toContain("graph-c");
    });

    it("should match by direct category field", async () => {
      const discovery = new StaticDiscovery(testServices);
      const result = await discovery.getServices("rag");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("graph-b");
    });

    it("should match by metadata.category as fallback", async () => {
      const services = [
        {
          name: "svc",
          address: "localhost",
          port: 3000,
          metadata: { category: "special" },
        },
      ];
      const discovery = new StaticDiscovery(services);
      const result = await discovery.getServices("special");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("svc");
    });

    it("should return empty array when no services match", async () => {
      const discovery = new StaticDiscovery(testServices);
      const result = await discovery.getServices("nonexistent");

      expect(result).toEqual([]);
    });

    it("should return empty array when no services registered", async () => {
      const discovery = new StaticDiscovery([]);
      const result = await discovery.getServices("chat");

      expect(result).toEqual([]);
    });
  });
});
