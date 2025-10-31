import { Injectable, Logger } from "@nestjs/common";
import { CallbackPatch } from "../interfaces/callback.interface";
import { CallbackPatchHandler } from "./callback-patch.service";

@Injectable()
export class TelegramPatchHandler implements CallbackPatchHandler {
  private readonly logger = new Logger(TelegramPatchHandler.name);

  async apply(patch: CallbackPatch, context?: any): Promise<void> {
    this.logger.debug(
      `Applying Telegram patch ${JSON.stringify(patch)} with context ${JSON.stringify(
        context
      )}`
    );
  }
}
