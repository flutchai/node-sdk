import { FlutchChatAnthropic } from "../models/anthropic-chat-model";

/**
 * The request body is what the API sees. `@langchain/anthropic` puts
 * `thinking: { type: "disabled" }` into it whenever the caller sets no thinking
 * mode, and Claude Sonnet 5.5 on the direct API rejects that value.
 */
describe("FlutchChatAnthropic request body", () => {
  const base = {
    model: "claude-sonnet-5-5",
    maxTokens: 1024,
    anthropicApiKey: "test-key",
  };

  it("leaves thinking out when none was configured", () => {
    const model = new FlutchChatAnthropic(base);

    expect(model.invocationParams()).not.toHaveProperty("thinking");
  });

  it("sends the configured thinking mode as given", () => {
    const model = new FlutchChatAnthropic({
      ...base,
      thinking: { type: "adaptive" },
    });

    expect(model.invocationParams().thinking).toEqual({
      type: "adaptive",
    });
  });

  it("sends an explicit disabled when it was asked for", () => {
    const model = new FlutchChatAnthropic({
      ...base,
      thinking: { type: "disabled" },
    });

    expect(model.invocationParams().thinking).toEqual({ type: "disabled" });
  });

  it("keeps the rest of the request as the library builds it", () => {
    const model = new FlutchChatAnthropic(base);
    const params = model.invocationParams();

    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.max_tokens).toBe(1024);
  });
});
