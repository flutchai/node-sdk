/**
 * A model's thoughts as it streams them, for the processing channel: Anthropic's `thinking` deltas and the deltas of
 * OpenAI's reasoning summary (`reasoning` blocks of the Responses API's chunks). Without this the processing channel
 * got a step's thoughts only after the step, when its text had already streamed (31.10.2026: the client read the
 * answer, then what the model thought before it).
 *
 * A graph asks for it in the metadata of the model's run: `stream_thinking: true`. The deltas go out as they come,
 * token by token; a new thought (another model run, another summary part) starts a new paragraph.
 */

export interface ThinkingDelta {
  text: string;
  /** The summary part (OpenAI) or the content block (Anthropic) the delta belongs to. */
  index: unknown;
}

export interface ThinkingStream {
  /** The model run being streamed. */
  runId: string | null;
  /** The part of that run being streamed. */
  index: unknown;
  /** Some thought was sent: the next one is set apart. */
  shown: boolean;
}

type Part = Record<string, unknown>;

/** The thoughts among a chunk's content blocks, and the other blocks, which stream as before. */
export function splitThinking(blocks: unknown[]): {
  thoughts: ThinkingDelta[];
  rest: unknown[];
} {
  const thoughts: ThinkingDelta[] = [];
  const rest: unknown[] = [];
  for (const block of blocks) {
    const part = block as Part;
    if (part?.type === "thinking" || part?.type === "reasoning") {
      // Anthropic's `thinking`, OpenAI's `reasoning`; a signature delta carries no text.
      const text = part.type === "thinking" ? part.thinking : part.reasoning;
      if (typeof text === "string" && text)
        thoughts.push({ text, index: part.index });
      continue;
    }
    rest.push(block);
  }
  return { thoughts, rest };
}

/**
 * The texts to send for a chunk's thoughts: the deltas as they are, a paragraph before the first of another run's or
 * another part's.
 */
export function thinkingTexts(
  state: ThinkingStream,
  runId: string | null,
  deltas: ThinkingDelta[]
): string[] {
  const out: string[] = [];
  for (const delta of deltas) {
    const another =
      runId !== state.runId ||
      (state.index !== undefined && delta.index !== state.index);
    out.push(state.shown && another ? `\n\n${delta.text}` : delta.text);
    state.runId = runId;
    state.index = delta.index;
    state.shown = true;
  }
  return out;
}
