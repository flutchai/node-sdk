import { Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { UniversalCallbackService } from "../callbacks";
import { CallbackTokenGuard, CallbackRequest } from "./callback-token.guard";

@ApiTags("Callbacks")
@Controller()
export class CallbackController {
  constructor(private readonly callbackService: UniversalCallbackService) {}

  @Post("callback")
  @UseGuards(CallbackTokenGuard)
  @ApiOperation({ summary: "Process callback by token" })
  @ApiResponse({ status: 200, description: "Callback executed" })
  async handleCallback(@Req() req: CallbackRequest) {
    return this.callbackService.handle(req.callbackRecord, req.user);
  }
}
