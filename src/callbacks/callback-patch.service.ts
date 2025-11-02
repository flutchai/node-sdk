import { Injectable, Logger } from "@nestjs/common";
import { CallbackRecord, CallbackPatch } from "./callback.interface";
import { TelegramPatchHandler } from "./telegram-patch.handler";
import { WebPatchHandler } from "./web-patch.handler";

export interface CallbackPatchHandler {
  apply(patch: CallbackPatch, context?: any): Promise<void>;
}

@Injectable()
export class CallbackPatchService {
  private readonly logger = new Logger(CallbackPatchService.name);
  constructor(
    private readonly telegram: TelegramPatchHandler,
    private readonly web: WebPatchHandler
  ) {}

  async apply(
    record: CallbackRecord,
    patch: CallbackPatch,
    context?: any
  ): Promise<void> {
    if (!patch) return;
    const platform = record.metadata?.platform;
    try {
      switch (platform) {
        case "telegram":
          await this.telegram.apply(patch, context);
          break;
        case "web":
          await this.web.apply(patch, context);
          break;
        default:
          this.logger.warn(`Unsupported patch platform: ${platform}`);
      }
    } catch (err) {
      this.logger.error(
        `Failed to apply patch for ${record.graphType}::${record.handler}`,
        err instanceof Error ? err.stack : undefined
      );
    }
  }
}
