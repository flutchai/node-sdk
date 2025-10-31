import { UniversalCallbackService } from "../src/callbacks/universal-callback.service";
import { CallbackRecord } from "@flutchai/flutch-sdk";
import { CallbackStore, SmartCallbackRouter } from "../src/callbacks";

describe("UniversalCallbackService failure handling", () => {
  it("records failure and returns error result", async () => {
    const record: CallbackRecord = {
      graphType: "g",
      handler: "h",
      userId: "u",
      params: {},
      token: "t",
      status: "processing",
      createdAt: Date.now(),
      retries: 0,
    };
    const store: Partial<CallbackStore> = {
      finalize: jest.fn(),
      fail: jest.fn().mockResolvedValue(null),
    };
    const router: Partial<SmartCallbackRouter> = {
      route: jest.fn().mockRejectedValue(new Error("boom")),
    };
    const service = new UniversalCallbackService(
      store as CallbackStore,
      router as SmartCallbackRouter
    );
    const result = await service.handle(record);
    expect(router.route).toHaveBeenCalledWith(record);
    expect(store.fail).toHaveBeenCalledWith("t", "boom");
    expect(store.finalize).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: "boom" });
  });
});

describe("CallbackStore retry mechanics", () => {
  it("updates status on fail and retry", async () => {
    const redis: any = {
      eval: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
    };
    const store = new CallbackStore(redis);
    redis.eval.mockResolvedValueOnce(
      JSON.stringify({
        token: "t",
        status: "failed",
        retries: 1,
        lastError: "err",
      })
    );
    const failed = await store.fail("t", "err");
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "callback:t",
      "err"
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.retries).toBe(1);
    redis.eval.mockResolvedValueOnce(
      JSON.stringify({ token: "t", status: "pending", retries: 1 })
    );
    const pending = await store.retry("t");
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "callback:t"
    );
    expect(pending?.status).toBe("pending");
  });
});
