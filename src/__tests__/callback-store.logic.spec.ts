import {
  generateCallbackToken,
  createCallbackRecord,
  resolveCallbackTTL,
  parseCallbackRecord,
  markAsProcessing,
  markAsFailed,
  markAsPending,
} from "../callbacks/callback-store.logic";
import { CallbackEntry, CallbackRecord } from "../callbacks/callback.interface";

function makeEntry(overrides?: Partial<CallbackEntry>): CallbackEntry {
  return {
    graphType: "test-graph",
    handler: "onApprove",
    userId: "user-1",
    params: { action: "approve" },
    ...overrides,
  };
}

function makeRecord(overrides?: Partial<CallbackRecord>): CallbackRecord {
  return {
    graphType: "test-graph",
    handler: "onApprove",
    userId: "user-1",
    params: { action: "approve" },
    token: "cb::test-graph::abc123",
    status: "pending",
    createdAt: 1700000000000,
    retries: 0,
    ...overrides,
  };
}

describe("callback-store.logic", () => {
  describe("generateCallbackToken", () => {
    it("should produce cb::{graphType}:: prefix", () => {
      const token = generateCallbackToken("my-graph");
      expect(token).toMatch(/^cb::my-graph::.+$/);
    });

    it("should generate unique tokens", () => {
      const t1 = generateCallbackToken("g");
      const t2 = generateCallbackToken("g");
      expect(t1).not.toBe(t2);
    });

    it("should use base64url characters (no +/=)", () => {
      // Generate many tokens and check none contain non-base64url chars
      for (let i = 0; i < 50; i++) {
        const token = generateCallbackToken("g");
        const random = token.split("::")[2];
        expect(random).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });
  });

  describe("createCallbackRecord", () => {
    it("should create record with pending status", () => {
      const entry = makeEntry();
      const record = createCallbackRecord(entry, "tok-1", 1700000000000);

      expect(record.token).toBe("tok-1");
      expect(record.status).toBe("pending");
      expect(record.createdAt).toBe(1700000000000);
      expect(record.retries).toBe(0);
    });

    it("should preserve entry fields", () => {
      const entry = makeEntry({ handler: "onReject", userId: "u-2" });
      const record = createCallbackRecord(entry, "tok-2", 0);

      expect(record.handler).toBe("onReject");
      expect(record.userId).toBe("u-2");
      expect(record.graphType).toBe("test-graph");
      expect(record.params).toEqual({ action: "approve" });
    });
  });

  describe("resolveCallbackTTL", () => {
    it("should return metadata.ttlSec when present", () => {
      expect(resolveCallbackTTL(makeEntry({ metadata: { ttlSec: 120 } }))).toBe(
        120
      );
    });

    it("should return 600 as default", () => {
      expect(resolveCallbackTTL(makeEntry())).toBe(600);
    });

    it("should return 600 when metadata exists but ttlSec is undefined", () => {
      expect(resolveCallbackTTL(makeEntry({ metadata: {} }))).toBe(600);
    });
  });

  describe("parseCallbackRecord", () => {
    it("should parse valid JSON", () => {
      const record = makeRecord();
      const parsed = parseCallbackRecord(JSON.stringify(record));

      expect(parsed).not.toBeNull();
      expect(parsed!.token).toBe("cb::test-graph::abc123");
      expect(parsed!.status).toBe("pending");
    });

    it("should return null on invalid JSON", () => {
      expect(parseCallbackRecord("not-json{{{")).toBeNull();
    });

    it("should return null on empty string", () => {
      expect(parseCallbackRecord("")).toBeNull();
    });
  });

  describe("markAsProcessing", () => {
    it("should set status to processing", () => {
      const result = markAsProcessing(makeRecord());
      expect(result.status).toBe("processing");
    });

    it("should not mutate original record", () => {
      const original = makeRecord();
      markAsProcessing(original);
      expect(original.status).toBe("pending");
    });
  });

  describe("markAsFailed", () => {
    it("should set status to failed and increment retries", () => {
      const result = markAsFailed(makeRecord(), "timeout");

      expect(result.status).toBe("failed");
      expect(result.retries).toBe(1);
      expect(result.lastError).toBe("timeout");
    });

    it("should increment existing retries", () => {
      const result = markAsFailed(makeRecord({ retries: 3 }), "err");
      expect(result.retries).toBe(4);
    });

    it("should not mutate original record", () => {
      const original = makeRecord();
      markAsFailed(original, "err");
      expect(original.status).toBe("pending");
      expect(original.retries).toBe(0);
    });
  });

  describe("markAsPending", () => {
    it("should set status to pending", () => {
      const result = markAsPending(makeRecord({ status: "failed" }));
      expect(result.status).toBe("pending");
    });

    it("should not mutate original record", () => {
      const original = makeRecord({ status: "failed" });
      markAsPending(original);
      expect(original.status).toBe("failed");
    });
  });
});
