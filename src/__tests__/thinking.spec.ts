import { extractThinking } from "../messages/thinking";

describe("extractThinking", () => {
  it("reads Anthropic's thinking blocks", () => {
    expect(
      extractThinking({
        content: [
          { type: "thinking", thinking: "I start with the profile." },
          { type: "text", text: "ok" },
        ],
      })
    ).toBe("I start with the profile.");
  });

  it("reads OpenAI's reasoning summary, in the message's additional_kwargs and in reasoning blocks", () => {
    expect(
      extractThinking({
        content: "ok",
        additional_kwargs: {
          reasoning: {
            type: "reasoning",
            summary: [
              { type: "summary_text", text: "Checking the stores first." },
              { type: "summary_text", text: "Then the prices." },
            ],
          },
        },
      })
    ).toBe("Checking the stores first.\n\nThen the prices.");
    expect(
      extractThinking({
        content: [
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "One thought." }],
          },
        ],
      })
    ).toBe("One thought.");
  });

  it("keeps a thought given in two places once, and an empty summary is nothing", () => {
    expect(
      extractThinking({
        content: [{ type: "reasoning", summary: [{ text: "Same." }] }],
        additional_kwargs: { reasoning: { summary: [{ text: "Same." }] } },
      })
    ).toBe("Same.");
    expect(
      extractThinking({
        content: "ok",
        additional_kwargs: { reasoning: { type: "reasoning", summary: [] } },
      })
    ).toBe("");
    expect(extractThinking({ content: [{ type: "text", text: "x" }] })).toBe(
      ""
    );
  });
});
