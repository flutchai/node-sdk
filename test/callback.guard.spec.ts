import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import {
  CallbackTokenGuard,
  CallbackRequest,
} from "../src/api/callback-token.guard";
import { CallbackRecord } from "@flutchai/flutch-sdk";
import { CallbackStore } from "../src/callbacks";

describe("CallbackTokenGuard", () => {
  const record: CallbackRecord = {
    graphType: "test",
    handler: "h",
    userId: "u",
    params: {},
    token: "cb_token",
    status: "pending",
    createdAt: Date.now(),
    retries: 0,
  };

  const createContext = (body: any, storeReturn: CallbackRecord | null) => {
    const store: Partial<CallbackStore> = {
      getAndLock: jest.fn().mockResolvedValue(storeReturn),
    };
    const guard = new CallbackTokenGuard(store as CallbackStore);
    const req: Partial<CallbackRequest> = { body };
    const context: Partial<ExecutionContext> = {
      switchToHttp: () => ({ getRequest: () => req }),
    };
    return { guard, req, context: context as ExecutionContext, store };
  };

  it("passes and attaches record for valid token", async () => {
    const { guard, req, context, store } = createContext(
      { token: "cb_token" },
      record
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req as CallbackRequest).callbackRecord).toEqual(record);
    expect(store.getAndLock as jest.Mock).toHaveBeenCalledWith("cb_token");
  });

  it("throws on missing token", async () => {
    const { guard, context } = createContext({}, record);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("throws on invalid token", async () => {
    const { guard, context, store } = createContext({ token: "bad" }, null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(store.getAndLock as jest.Mock).toHaveBeenCalledWith("bad");
  });
});
