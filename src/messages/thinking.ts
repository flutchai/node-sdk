/**
 * What a model thought in one step, whatever the provider: the text a graph shows its client in the processing channel.
 * Anthropic returns it as `thinking` blocks in the content; OpenAI's Responses API as a reasoning summary, in the
 * message's `additional_kwargs.reasoning.summary` or in `reasoning` blocks of its content. A graph reads no provider's
 * format itself (31.10.2026: gpt-6.1-sol's thoughts never reached the client, the graph read the Anthropic form only).
 */

type Part = Record<string, unknown>;

interface ThinkingSource {
  content?: unknown;
  additional_kwargs?: Record<string, unknown> | undefined;
}

const textOf = (part: unknown): string =>
  typeof part === "string"
    ? part
    : part && typeof (part as Part).text === "string"
      ? String((part as Part).text)
      : "";

const summaryTexts = (summary: unknown): string[] =>
  Array.isArray(summary) ? summary.map(textOf) : [];

/**
 * The step's thoughts as one text, paragraphs apart; the same thought given in two places is kept once, an empty
 * summary is nothing (OpenAI sends one when a step did not need explaining).
 */
export function extractThinking(message: ThinkingSource): string {
  const blocks: Part[] = Array.isArray(message.content)
    ? (message.content as Part[])
    : [];
  const reasoning = message.additional_kwargs?.reasoning as
    | { summary?: unknown }
    | undefined;
  return [
    ...blocks
      .filter(b => b?.type === "thinking" && typeof b.thinking === "string")
      .map(b => String(b.thinking)),
    ...blocks
      .filter(b => b?.type === "reasoning")
      .flatMap(b => summaryTexts(b.summary)),
    ...summaryTexts(reasoning?.summary),
  ]
    .map(t => t.trim())
    .filter(Boolean)
    .filter((t, i, all) => all.indexOf(t) === i)
    .join("\n\n");
}
