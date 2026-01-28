import {
  CallbackAuditor,
  CallbackAuditAction,
} from "../callbacks/callback-auditor.service";

describe("CallbackAuditor", () => {
  let auditor: CallbackAuditor;

  beforeEach(() => {
    auditor = new CallbackAuditor();
  });

  const makeRecord = (overrides: Record<string, any> = {}) => ({
    token: "tok_1",
    graphType: "chat::1.0.0",
    handler: "confirm",
    userId: "user-1",
    createdAt: Date.now() - 1000,
    retries: 0,
    status: "pending",
    lastError: undefined,
    metadata: {},
    ...overrides,
  });

  const makeUser = (userId = "user-1") => ({
    userId,
    roles: [],
    permissions: [],
  });

  describe("logTokenIssued", () => {
    it("should log token issuance and return correlationId", async () => {
      const corrId = await auditor.logTokenIssued(
        "tok_1",
        "chat",
        "confirm",
        "user-1",
        { ttlSec: 600 }
      );

      expect(corrId).toMatch(/^cb_/);

      const trail = await auditor.getTokenAuditTrail("tok_1");
      expect(trail).toHaveLength(1);
      expect(trail[0].action).toBe(CallbackAuditAction.TOKEN_ISSUED);
      expect(trail[0].userId).toBe("user-1");
    });
  });

  describe("logExecutionStart", () => {
    it("should log execution start", async () => {
      const corrId = await auditor.logExecutionStart(
        makeRecord() as any,
        makeUser()
      );

      expect(corrId).toMatch(/^cb_/);

      const trail = await auditor.getTokenAuditTrail("tok_1");
      expect(trail).toHaveLength(1);
      expect(trail[0].action).toBe(CallbackAuditAction.EXECUTION_STARTED);
    });

    it("should use provided correlationId", async () => {
      const corrId = await auditor.logExecutionStart(
        makeRecord() as any,
        makeUser(),
        "custom_corr_id"
      );
      expect(corrId).toBe("custom_corr_id");
    });

    it("should handle undefined user", async () => {
      const corrId = await auditor.logExecutionStart(
        makeRecord() as any,
        undefined
      );
      expect(corrId).toBeDefined();
    });
  });

  describe("logExecutionSuccess", () => {
    it("should log successful execution", async () => {
      const result = { action: "proceed", message: "Done" };
      await auditor.logExecutionSuccess(
        makeRecord() as any,
        makeUser(),
        result as any,
        150,
        "corr_1"
      );

      const trail = await auditor.getTokenAuditTrail("tok_1");
      expect(trail).toHaveLength(1);
      expect(trail[0].action).toBe(CallbackAuditAction.EXECUTION_COMPLETED);
      expect(trail[0].duration).toBe(150);
      expect(trail[0].success).toBe(true);
    });
  });

  describe("logExecutionFailure", () => {
    it("should log failed execution", async () => {
      await auditor.logExecutionFailure(
        makeRecord() as any,
        makeUser(),
        new Error("timeout"),
        200,
        "corr_1"
      );

      const trail = await auditor.getTokenAuditTrail("tok_1");
      expect(trail).toHaveLength(1);
      expect(trail[0].action).toBe(CallbackAuditAction.EXECUTION_FAILED);
      expect(trail[0].error).toBe("timeout");
      expect(trail[0].success).toBe(false);
    });
  });

  describe("logAccessDenied", () => {
    it("should log access denied", async () => {
      await auditor.logAccessDenied("tok_1", "user-1", "no permission");

      const trail = await auditor.getTokenAuditTrail("tok_1");
      expect(trail).toHaveLength(1);
      expect(trail[0].action).toBe(CallbackAuditAction.ACCESS_DENIED);
      expect(trail[0].error).toBe("no permission");
    });
  });

  describe("logRateLimited", () => {
    it("should log rate limiting", async () => {
      await auditor.logRateLimited("user-1", 60, {
        token: "tok_1",
        graphType: "chat",
      });

      const trail = await auditor.getTokenAuditTrail("tok_1");
      expect(trail).toHaveLength(1);
      expect(trail[0].action).toBe(CallbackAuditAction.RATE_LIMITED);
      expect(trail[0].metadata.retryAfter).toBe(60);
    });
  });

  describe("logRetryAttempt", () => {
    it("should log retry attempt", async () => {
      const corrId = await auditor.logRetryAttempt(
        makeRecord({ retries: 2 }) as any,
        makeUser(),
        3
      );

      expect(corrId).toMatch(/^cb_/);
      const trail = await auditor.getTokenAuditTrail("tok_1");
      expect(trail[0].action).toBe(CallbackAuditAction.RETRY_ATTEMPTED);
      expect(trail[0].metadata.attemptNumber).toBe(3);
    });
  });

  describe("getTokenAuditTrail", () => {
    it("should return entries sorted by timestamp", async () => {
      await auditor.logExecutionStart(makeRecord() as any, makeUser());
      // Small delay to ensure different timestamps
      await auditor.logExecutionSuccess(
        makeRecord() as any,
        makeUser(),
        { action: "ok" } as any,
        100,
        "corr"
      );

      const trail = await auditor.getTokenAuditTrail("tok_1");
      expect(trail).toHaveLength(2);
      expect(trail[0].timestamp).toBeLessThanOrEqual(trail[1].timestamp);
    });

    it("should return empty array for unknown token", async () => {
      const trail = await auditor.getTokenAuditTrail("unknown");
      expect(trail).toEqual([]);
    });
  });

  describe("getUserAuditTrail", () => {
    it("should filter by userId", async () => {
      await auditor.logTokenIssued("tok_1", "chat", "h", "user-1");
      await auditor.logTokenIssued("tok_2", "chat", "h", "user-2");

      const trail = await auditor.getUserAuditTrail("user-1");
      expect(trail).toHaveLength(1);
      expect(trail[0].userId).toBe("user-1");
    });

    it("should filter by time range", async () => {
      const now = Date.now();
      await auditor.logTokenIssued("tok_1", "chat", "h", "user-1");

      const trail = await auditor.getUserAuditTrail(
        "user-1",
        now - 1000,
        now + 1000
      );
      expect(trail).toHaveLength(1);

      const emptyTrail = await auditor.getUserAuditTrail("user-1", 0, 1);
      expect(emptyTrail).toHaveLength(0);
    });
  });

  describe("getStatistics", () => {
    it("should compute statistics", async () => {
      const now = Date.now();
      await auditor.logExecutionSuccess(
        makeRecord() as any,
        makeUser(),
        { action: "ok" } as any,
        100,
        "c1"
      );
      await auditor.logExecutionFailure(
        makeRecord({ graphType: "rag" }) as any,
        makeUser(),
        new Error("fail"),
        200,
        "c2"
      );
      await auditor.logAccessDenied("tok_3", "u1", "denied");

      const stats = await auditor.getStatistics(now - 1000, now + 5000);
      expect(stats.successfulExecutions).toBe(1);
      expect(stats.failedExecutions).toBe(1);
      expect(stats.accessDenied).toBe(1);
      expect(stats.averageDuration).toBe(150); // (100+200)/2
      expect(stats.byGraphType["chat::1.0.0"]).toBe(1);
      expect(stats.byGraphType["rag"]).toBe(1);
    });
  });

  describe("exportAuditLogs", () => {
    it("should export as JSON", async () => {
      await auditor.logTokenIssued("tok_1", "chat", "confirm", "user-1");
      const json = await auditor.exportAuditLogs(0, Date.now() + 1000, "json");

      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].callbackToken).toBe("tok_1");
    });

    it("should export as CSV", async () => {
      await auditor.logTokenIssued("tok_1", "chat", "confirm", "user-1");
      const csv = await auditor.exportAuditLogs(0, Date.now() + 1000, "csv");

      const lines = csv.split("\n");
      expect(lines[0]).toContain("id,correlationId,timestamp");
      expect(lines).toHaveLength(2); // header + 1 entry
    });
  });
});
