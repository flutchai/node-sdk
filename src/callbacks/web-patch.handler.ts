import { Injectable, Logger } from "@nestjs/common";
import { CallbackPatch } from "../interfaces/callback.interface";
import { CallbackPatchHandler } from "./callback-patch.service";

@Injectable()
export class WebPatchHandler implements CallbackPatchHandler {
  private readonly logger = new Logger(WebPatchHandler.name);

  async apply(patch: CallbackPatch, context?: any): Promise<void> {
    this.logger.debug(
      `Applying Web patch ${JSON.stringify(patch)} with context ${JSON.stringify(
        context
      )}`
    );
  }
}
