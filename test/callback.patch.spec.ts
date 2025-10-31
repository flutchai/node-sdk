import { SmartCallbackRouter } from "../src/callbacks/smart-callback.router";
import {
  CallbackStore,
  CallbackRegistry,
  CallbackACL,
  CallbackAuditor,
  CallbackMetrics,
  CallbackRateLimiter,
  IdempotencyManager,
  CallbackPatchService,
} from "../src/callbacks";
import { CallbackRecord, CallbackPatch } from "@flutchai/flutch-sdk";
import { IdempotencyStatus } from "../src/callbacks/idempotency-manager";

describe("SmartCallbackRouter patch handling", () => {
  function createRouter(patchService: CallbackPatchService) {
    const handler = jest.fn().mockResolvedValue({
      success: true,
      patch: { editMessage: "ok", disableButtons: true } as CallbackPatch,
    });
    const registry: Partial<CallbackRegistry> = {
      get: jest.fn().mockReturnValue(handler),
    };
    const store: Partial<CallbackStore> = {
      finalize: jest.fn().mockResolvedValue(undefined),
    };
    const acl: Partial<CallbackACL> = {
      validate: jest.fn().mockResolvedValue(undefined),
    };
    const auditor: Partial<CallbackAuditor> = {
      logExecutionStart: jest.fn().mockResolvedValue("c1"),
      logExecutionSuccess: jest.fn().mockResolvedValue(undefined),
      logExecutionFailure: jest.fn(),
      logRetryAttempt: jest.fn(),
      logRateLimited: jest.fn(),
    };
    const metrics: Partial<CallbackMetrics> = {
      recordAclValidation: jest.fn(),
      recordTokenAge: jest.fn(),
      recordExecutionStart: jest.fn(),
      recordExecutionComplete: jest.fn(),
      recordRetry: jest.fn(),
      recordRateLimited: jest.fn(),
    };
    const rateLimiter: Partial<CallbackRateLimiter> = {
      checkUserLimit: jest.fn().mockResolvedValue({ allowed: true }),
      checkIpLimit: jest.fn().mockResolvedValue({ allowed: true }),
    };
    const idempotencyManager: Partial<IdempotencyManager> = {
      checkAndLock: jest
        .fn()
        .mockResolvedValue({ status: IdempotencyStatus.NEW, key: "k" }),
      storeResult: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };

    return new SmartCallbackRouter(
      registry as CallbackRegistry,
      store as CallbackStore,
      acl as CallbackACL,
      auditor as CallbackAuditor,
      metrics as CallbackMetrics,
      rateLimiter as CallbackRateLimiter,
      idempotencyManager as IdempotencyManager,
      patchService
    );
  }

  it.each([["telegram"], ["web"]])(
    "delegates patch to %s handler",
    async platform => {
      const telegramHandler = { apply: jest.fn().mockResolvedValue(undefined) };
      const webHandler = { apply: jest.fn().mockResolvedValue(undefined) };
      const patchService = new CallbackPatchService(
        telegramHandler as any,
        webHandler as any
      );
      const router = createRouter(patchService);

      const record: CallbackRecord = {
        graphType: "g",
        handler: "h",
        userId: "u",
        params: {},
        token: "t",
        status: "processing",
        createdAt: Date.now(),
        retries: 0,
        metadata: { platform },
      };

      await router.route(record, undefined, { platformContext: { id: 1 } });

      if (platform === "telegram") {
        expect(telegramHandler.apply).toHaveBeenCalledWith(
          { editMessage: "ok", disableButtons: true },
          { id: 1 }
        );
        expect(webHandler.apply).not.toHaveBeenCalled();
      } else {
        expect(webHandler.apply).toHaveBeenCalledWith(
          { editMessage: "ok", disableButtons: true },
          { id: 1 }
        );
        expect(telegramHandler.apply).not.toHaveBeenCalled();
      }
    }
  );
});
