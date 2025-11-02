import { CallbackStore } from "./callback-store";
import { SmartCallbackRouter } from "./smart-callback.router";
import { CallbackResult, CallbackRecord } from "./callback.interface";

export class UniversalCallbackService {
  constructor(
    private readonly store: CallbackStore,
    private readonly router: SmartCallbackRouter
  ) {}

  async handle(
    record: CallbackRecord,
    user?: any,
    metadata?: {
      ip?: string;
      userAgent?: string;
      platform?: string;
      platformContext?: any;
    }
  ): Promise<CallbackResult> {
    try {
      const result = await this.router.route(record, user, metadata);
      // Note: finalization is now handled by the router
      return result;
    } catch (err: any) {
      return { success: false, error: err?.message || "Callback error" };
    }
  }
}
