/**
 * `ChatAnthropic` that sends only what it was configured with.
 *
 * `@langchain/anthropic` fills `thinking` with `{ type: "disabled" }` when the
 * caller sets none and puts it in every request. The SDK has no opinion on the
 * thinking mode: unset means the model's own default, which is what the API
 * applies when the field is absent. The library's default is not neutral —
 * Claude Sonnet 5.5 on the direct API rejects `disabled` outright and asks for
 * `between_tools`.
 *
 * Inside the client `this.thinking` keeps the library's value, so its own
 * checks (sampling params, structured output) behave as before; only the
 * request body loses a field nobody asked for.
 */

import { ChatAnthropic } from "@langchain/anthropic";

type ChatAnthropicFields = ConstructorParameters<typeof ChatAnthropic>[0];

export class FlutchChatAnthropic extends ChatAnthropic {
  private readonly thinkingConfigured: boolean;

  static lc_name(): string {
    return "FlutchChatAnthropic";
  }

  constructor(fields?: ChatAnthropicFields) {
    super(fields);
    this.thinkingConfigured = fields?.thinking !== undefined;
  }

  override invocationParams(
    options?: this["ParsedCallOptions"]
  ): ReturnType<ChatAnthropic["invocationParams"]> {
    const params = super.invocationParams(options);
    if (this.thinkingConfigured) return params;
    const { thinking: _libraryDefault, ...sent } = params;
    return sent;
  }
}
