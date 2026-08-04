/**
 * `ChatBedrockConverse` with outgoing-history sanitizing.
 *
 * `@langchain/aws` forwards assistant reasoning blocks to the Converse API
 * verbatim. Claude Opus 5 returns reasoning as a signature-only block (no
 * `text`), and the Converse *request* schema requires
 * `reasoningContent.reasoningText.text` to be non-null — so replaying such a
 * message as history rejects the entire request:
 *
 *   ValidationException: Value at 'messages.N.member.content.M.member
 *   .reasoningContent.reasoningText.text' failed to satisfy constraint:
 *   Member must not be null
 *
 * Both entry points into the provider (`_generate` for `.invoke()`,
 * `_streamResponseChunks` for `.stream()` / `streamEvents`) sanitize the
 * message list before it reaches `convertToConverseMessages`. See
 * `reasoning-content.logic.ts` for what "sanitize" means and why.
 *
 * The subclass changes nothing else: tool binding, structured output, cache
 * points, callbacks and streaming all behave exactly as in the base class, and
 * a history without malformed reasoning blocks is passed through by reference.
 */

import { ChatBedrockConverse } from "@langchain/aws";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import { Logger } from "@nestjs/common";

import { sanitizeReasoningForBedrock } from "./reasoning-content.logic";

const logger = new Logger("FlutchChatBedrockConverse");

export class FlutchChatBedrockConverse extends ChatBedrockConverse {
  static lc_name(): string {
    return "FlutchChatBedrockConverse";
  }

  private sanitize(messages: BaseMessage[]): BaseMessage[] {
    const { messages: cleaned, sanitized } =
      sanitizeReasoningForBedrock(messages);

    if (sanitized > 0) {
      logger.debug(
        `Dropped ${sanitized} unsendable reasoning block(s) from outgoing history (model=${this.model})`
      );
    }

    return cleaned;
  }

  /** `.invoke()` / `.generate()` path. */
  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    return super._generate(this.sanitize(messages), options, runManager);
  }

  /** `.stream()` / `streamEvents()` path (also used by `_generate` when the
   * model is constructed with `streaming: true` — sanitizing is idempotent). */
  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    yield* super._streamResponseChunks(
      this.sanitize(messages),
      options,
      runManager
    );
  }
}
