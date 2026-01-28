import { CallbackStore } from "../callbacks/callback-store";
import { CallbackEntry } from "../callbacks/callback.interface";

/**
 * Mock Redis instance with basic operations
 */
function createMockRedis() {
  const store = new Map<string, { value: string; ttl?: number }>();

  return {
    _store: store,
    setex: jest.fn(async (key: string, ttl: number, value: string) => {
      store.set(key, { value, ttl });
      return "OK";
    }),
    set: jest.fn(async (key: string, value: string) => {
      const existing = store.get(key);
      store.set(key, { value, ttl: existing?.ttl });
      return "OK";
    }),
    get: jest.fn(async (key: string) => {
      return store.get(key)?.value ?? null;
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    eval: jest.fn(),
  };
}

function makeEntry(overrides?: Partial<CallbackEntry>): CallbackEntry {
  return {
    graphType: "test-graph",
    handler: "onApprove",
    userId: "user-1",
    params: { action: "approve" },
    ...overrides,
  };
}

describe("CallbackStore", () => {
  let redis: ReturnType<typeof createMockRedis>;
  let store: CallbackStore;

  beforeEach(() => {
    redis = createMockRedis();
    // Force non-production to use simple (non-Lua) code paths
    process.env.NODE_ENV = "test";
    store = new CallbackStore(redis as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("issue", () => {
    it("should generate token with cb:: prefix and graphType", async () => {
      const token = await store.issue(makeEntry());

      expect(token).toMatch(/^cb::test-graph::/);
      expect(redis.setex).toHaveBeenCalledTimes(1);
    });

    it("should persist record with correct fields", async () => {
      const token = await store.issue(makeEntry());

      const [key, ttl, json] = redis.setex.mock.calls[0];
      expect(key).toBe(`callback:${token}`);
      expect(ttl).toBe(600); // default TTL

      const record = JSON.parse(json);
      expect(record.status).toBe("pending");
      expect(record.retries).toBe(0);
      expect(record.graphType).toBe("test-graph");
      expect(record.handler).toBe("onApprove");
      expect(record.token).toBe(token);
      expect(record.createdAt).toEqual(expect.any(Number));
    });

    it("should use custom TTL from metadata", async () => {
      await store.issue(makeEntry({ metadata: { ttlSec: 120 } }));

      const [, ttl] = redis.setex.mock.calls[0];
      expect(ttl).toBe(120);
    });

    it("should generate unique tokens", async () => {
      const t1 = await store.issue(makeEntry());
      const t2 = await store.issue(makeEntry());

      expect(t1).not.toBe(t2);
    });
  });

  describe("getAndLock (simple/dev mode)", () => {
    it("should return record and set status to processing", async () => {
      const token = await store.issue(makeEntry());

      const record = await store.getAndLock(token);

      expect(record).not.toBeNull();
      expect(record!.status).toBe("processing");
      // Redis.set should have been called to update status
      expect(redis.set).toHaveBeenCalled();
    });

    it("should return null for non-existent token", async () => {
      const result = await store.getAndLock("non-existent");
      expect(result).toBeNull();
    });

    it("should return null if status is not pending", async () => {
      const token = await store.issue(makeEntry());

      // First lock succeeds
      await store.getAndLock(token);

      // Second lock should fail (status is now 'processing')
      const result = await store.getAndLock(token);
      expect(result).toBeNull();
    });

    it("should return null on invalid JSON in Redis", async () => {
      redis._store.set("callback:bad-token", { value: "not-json{{{" });

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await store.getAndLock("bad-token");

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("finalize", () => {
    it("should delete the callback key", async () => {
      const token = await store.issue(makeEntry());

      await store.finalize(token);

      expect(redis.del).toHaveBeenCalledWith(`callback:${token}`);
    });
  });

  describe("fail (simple/dev mode)", () => {
    it("should set status to failed and increment retries", async () => {
      const token = await store.issue(makeEntry());

      const record = await store.fail(token, "Connection refused");

      expect(record).not.toBeNull();
      expect(record!.status).toBe("failed");
      expect(record!.retries).toBe(1);
      expect(record!.lastError).toBe("Connection refused");
    });

    it("should return null for non-existent token", async () => {
      const result = await store.fail("missing", "error");
      expect(result).toBeNull();
    });

    it("should increment retries on repeated failures", async () => {
      const token = await store.issue(makeEntry());

      await store.fail(token, "Error 1");
      const record = await store.fail(token, "Error 2");

      expect(record!.retries).toBe(2);
      expect(record!.lastError).toBe("Error 2");
    });

    it("should return null on invalid JSON", async () => {
      redis._store.set("callback:bad", { value: "invalid" });

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await store.fail("bad", "err");

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("retry (simple/dev mode)", () => {
    it("should reset status to pending", async () => {
      const token = await store.issue(makeEntry());

      // Fail first
      await store.fail(token, "some error");

      // Retry
      const record = await store.retry(token);

      expect(record).not.toBeNull();
      expect(record!.status).toBe("pending");
    });

    it("should return null for non-existent token", async () => {
      const result = await store.retry("missing");
      expect(result).toBeNull();
    });

    it("should return null on invalid JSON", async () => {
      redis._store.set("callback:bad", { value: "invalid" });

      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const result = await store.retry("bad");

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("production mode (Lua scripts)", () => {
    let prodStore: CallbackStore;

    beforeEach(() => {
      process.env.NODE_ENV = "production";
      prodStore = new CallbackStore(redis as any);
    });

    it("getAndLock should use eval (Lua script)", async () => {
      const token = await prodStore.issue(makeEntry());

      redis.eval.mockResolvedValue(
        JSON.stringify({
          ...JSON.parse(redis._store.get(`callback:${token}`)!.value),
          status: "processing",
        })
      );

      const record = await prodStore.getAndLock(token);

      expect(redis.eval).toHaveBeenCalledTimes(1);
      expect(record).not.toBeNull();
      expect(record!.status).toBe("processing");
    });

    it("getAndLock should return null when eval returns null", async () => {
      redis.eval.mockResolvedValue(null);

      const result = await prodStore.getAndLock("missing");
      expect(result).toBeNull();
    });

    it("fail should use eval (Lua script)", async () => {
      const token = await prodStore.issue(makeEntry());

      redis.eval.mockResolvedValue(
        JSON.stringify({
          status: "failed",
          retries: 1,
          lastError: "timeout",
        })
      );

      const record = await prodStore.fail(token, "timeout");

      expect(redis.eval).toHaveBeenCalled();
      expect(record!.status).toBe("failed");
    });

    it("retry should use eval (Lua script)", async () => {
      redis.eval.mockResolvedValue(
        JSON.stringify({ status: "pending", retries: 1 })
      );

      const record = await prodStore.retry("some-token");

      expect(redis.eval).toHaveBeenCalled();
      expect(record!.status).toBe("pending");
    });

    it("retry should return null when eval returns null", async () => {
      redis.eval.mockResolvedValue(null);

      const result = await prodStore.retry("missing");
      expect(result).toBeNull();
    });
  });

  describe("full lifecycle", () => {
    it("issue → getAndLock → finalize", async () => {
      const token = await store.issue(makeEntry());

      const locked = await store.getAndLock(token);
      expect(locked!.status).toBe("processing");

      await store.finalize(token);
      expect(redis.del).toHaveBeenCalled();

      // After finalize, get should return null
      const after = await store.getAndLock(token);
      expect(after).toBeNull();
    });

    it("issue → fail → retry → getAndLock", async () => {
      const token = await store.issue(makeEntry());

      await store.fail(token, "error");
      const failed = await store.getAndLock(token);
      expect(failed).toBeNull(); // status is 'failed', not 'pending'

      await store.retry(token);
      const retried = await store.getAndLock(token);
      expect(retried).not.toBeNull();
      expect(retried!.status).toBe("processing");
    });
  });
});
