import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  RemoveMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { REMOVE_ALL_MESSAGES } from "@langchain/langgraph";

/**
 * Auto-compaction of a thread's history: once the context of the next model call crosses a threshold, the earlier
 * turns are replaced in the graph's state by one summary, and the model goes on from the summary and the latest
 * turns. The thread the client and the console see is not touched — only what the model is sent.
 *
 * Shape: the summary is one user message at the start of the history, followed by the last `keepRecentTurns` client
 * turns kept as they were, minus the model's thinking. A thinking block is bound to the whole history it was made
 * with (Claude 5.x rejects one replayed after the history before it changed), so the kept turns go without theirs.
 * Compaction runs only at the start of a client turn, never in the middle of a tool round.
 */
export interface AutoCompactSettings {
  enabled?: boolean;
  /** Context size (tokens) of the next model call from which the history is compacted. */
  triggerTokens?: number;
  /** Client turns before the current one kept word for word after the summary. */
  keepRecentTurns?: number;
  /** Model that writes the summary; the graph's or the agent's own model when unset. */
  modelId?: string;
  /** What else the summary must keep, added to the summarizer's instructions. */
  instructions?: string;
}

export interface ResolvedAutoCompactSettings {
  triggerTokens: number;
  keepRecentTurns: number;
  modelId?: string;
  instructions?: string;
}

export const AUTO_COMPACT_DEFAULT_TRIGGER_TOKENS = 100_000;
export const AUTO_COMPACT_DEFAULT_KEEP_RECENT_TURNS = 1;
const MIN_TRIGGER_TOKENS = 4_000;

/** Characters per token for the estimate when no usage is known; pessimistic for Cyrillic so the estimate errs high. */
const CHARS_PER_TOKEN = 3;
/** A tool result or tool input longer than this is cut in the transcript the summarizer reads. */
const TRANSCRIPT_PART_CHARS = 6_000;

const SUMMARY_MARK = "autoCompactSummary";
const SUMMARY_HEADER =
  "[Summary of the conversation so far — the earlier messages are no longer available]";
const KEPT_MARK = "autoCompactKept";

const positiveInt = (value: unknown): number | undefined => {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0
    ? Math.floor(n)
    : undefined;
};

/**
 * The agent's `autoCompact` setting, or null when it is off. `true` turns it on with the defaults; an object needs
 * `enabled: true`. Unset means off, so agents configured before the setting existed keep their behaviour.
 */
export function resolveAutoCompactSettings(
  value: unknown
): ResolvedAutoCompactSettings | null {
  if (value === true) {
    return {
      triggerTokens: AUTO_COMPACT_DEFAULT_TRIGGER_TOKENS,
      keepRecentTurns: AUTO_COMPACT_DEFAULT_KEEP_RECENT_TURNS,
    };
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.enabled !== true && raw.enabled !== "true") return null;
  const trigger = positiveInt(raw.triggerTokens);
  const keep = positiveInt(raw.keepRecentTurns);
  const modelId =
    typeof raw.modelId === "string" && raw.modelId.trim()
      ? raw.modelId.trim()
      : undefined;
  const instructions =
    typeof raw.instructions === "string" && raw.instructions.trim()
      ? raw.instructions.trim()
      : undefined;
  return {
    triggerTokens: Math.max(
      MIN_TRIGGER_TOKENS,
      trigger || AUTO_COMPACT_DEFAULT_TRIGGER_TOKENS
    ),
    keepRecentTurns: keep ?? AUTO_COMPACT_DEFAULT_KEEP_RECENT_TURNS,
    ...(modelId ? { modelId } : {}),
    ...(instructions ? { instructions } : {}),
  };
}

const marks = (m: BaseMessage) =>
  (m.additional_kwargs ?? {}) as Record<string, unknown>;

/** The summary an auto-compaction put in place of the earlier turns. */
export const isCompactSummary = (m: BaseMessage): boolean =>
  marks(m)[SUMMARY_MARK] === true;

const isKept = (m: BaseMessage) => marks(m)[KEPT_MARK] === true;

const typeOf = (m: BaseMessage) => m._getType();

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value);
  }
}

/** Rough token count of one message: its content and the arguments of its tool calls. */
export function estimateMessageTokens(m: BaseMessage): number {
  const calls =
    typeOf(m) === "ai" ? ((m as AIMessage).tool_calls ?? []) : undefined;
  const chars =
    stringify(m.content).length + (calls?.length ? stringify(calls).length : 0);
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * The context the next model call will carry: the input and output of the last call the model reported (system
 * prompt and tools included) plus an estimate of what came after it. Without a reported call, an estimate of the
 * whole history. A message kept by an earlier compaction carries the usage of a call made before it, so it is
 * estimated, not trusted.
 */
export function contextTokens(messages: BaseMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (typeOf(m) !== "ai" || isKept(m)) continue;
    const usage = (m as AIMessage).usage_metadata as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    if (!usage?.input_tokens) continue;
    return (
      usage.input_tokens +
      (usage.output_tokens ?? 0) +
      messages
        .slice(i + 1)
        .reduce((sum, x) => sum + estimateMessageTokens(x), 0)
    );
  }
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/** A message the model is never shown (a graph's own signal, a trigger payload): not in the summary, not a turn. */
export type HiddenMessage = (m: BaseMessage) => boolean;

const notHidden: HiddenMessage = () => false;

/** Which user messages are the client's own (a turn starts at one); the rest are the graph's notes. */
export type ClientMessage = (m: BaseMessage) => boolean;

const anyUserMessage: ClientMessage = m => typeOf(m) === "human";

export interface MessageKinds {
  /** Messages the model is never shown: left out of the summary and not counted as client turns. */
  isHidden?: HiddenMessage;
  /** The client's own user messages; other user messages (the graph's notes) are summarised but start no turn. */
  isClientMessage?: ClientMessage;
}

/** Where each client turn starts: a client message whose previous shown message is not one. */
function turnStarts(messages: BaseMessage[], kinds: MessageKinds): number[] {
  const isHidden = kinds.isHidden ?? notHidden;
  const isClient = kinds.isClientMessage ?? anyUserMessage;
  const starts: number[] = [];
  let prevWasClient = false;
  messages.forEach((m, i) => {
    if (isHidden(m)) return;
    const client = typeOf(m) === "human" && !isCompactSummary(m) && isClient(m);
    if (client && !prevWasClient) starts.push(i);
    prevWasClient = client;
  });
  return starts;
}

export interface CompactionPlan {
  /** The messages the summary replaces. */
  head: BaseMessage[];
  /** The messages kept after the summary, as they are in the state. */
  tail: BaseMessage[];
  tokens: number;
}

/**
 * What to compact now, or null: off below the threshold, in the middle of a tool round (the last message is not the
 * client's), and when nothing older than the kept turns is left to summarise. When the kept turns alone would cross
 * the threshold, only the current turn is kept.
 */
export function planCompaction(
  messages: BaseMessage[],
  settings: ResolvedAutoCompactSettings,
  kinds: MessageKinds = {}
): CompactionPlan | null {
  const isHidden = kinds.isHidden ?? notHidden;
  const last = messages[messages.length - 1];
  if (!last || typeOf(last) !== "human") return null;
  const tokens = contextTokens(messages);
  if (tokens < settings.triggerTokens) return null;
  const starts = turnStarts(messages, kinds);
  if (!starts.length) return null;
  const current = starts.length - 1;
  const cutAt = (keep: number) => starts[Math.max(0, current - keep)];
  let cut = cutAt(settings.keepRecentTurns);
  const tailTokens = messages
    .slice(cut)
    .reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  if (tailTokens >= settings.triggerTokens) cut = cutAt(0);
  if (cut <= 0) return null;
  const head = messages.slice(0, cut);
  if (head.every(m => isCompactSummary(m) || isHidden(m))) return null;
  return { head, tail: messages.slice(cut), tokens };
}

const THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"]);

/** A kept message without the model's thinking (bound to the history before the summary) and marked as kept. */
function keptCopy(m: BaseMessage): BaseMessage {
  if (typeOf(m) !== "ai") return m;
  const ai = m as AIMessage;
  const content = Array.isArray(ai.content)
    ? ai.content.filter(
        block => !THINKING_TYPES.has((block as { type?: string })?.type ?? "")
      )
    : ai.content;
  const { reasoning: _reasoning, ...kwargs } = (ai.additional_kwargs ??
    {}) as Record<string, unknown>;
  return new AIMessage({
    id: ai.id,
    name: ai.name,
    content: content as AIMessage["content"],
    tool_calls: ai.tool_calls,
    invalid_tool_calls: ai.invalid_tool_calls,
    response_metadata: ai.response_metadata,
    additional_kwargs: { ...kwargs, [KEPT_MARK]: true },
  });
}

const clip = (text: string, max: number) =>
  text.length <= max
    ? text
    : `${text.slice(0, Math.floor(max * 0.7))}\n[…${text.length - max} characters cut…]\n${text.slice(text.length - Math.floor(max * 0.3))}`;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return stringify(content);
  return content
    .map(block => {
      if (typeof block === "string") return block;
      const b = block as Record<string, unknown>;
      if (b?.type === "text") return String(b.text ?? "");
      if (THINKING_TYPES.has(String(b?.type)) || b?.type === "tool_use")
        return "";
      if (b?.type === "image" || b?.type === "image_url") return "[image]";
      if (b?.type === "document" || b?.type === "file") return "[file]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** The summarised turns as a plain transcript: provider-neutral, no tool-call pairing to keep valid. */
export function renderTranscript(
  messages: BaseMessage[],
  kinds: MessageKinds = {}
): string {
  const isHidden = kinds.isHidden ?? notHidden;
  const isClient = kinds.isClientMessage ?? anyUserMessage;
  return messages
    .filter(m => !isHidden(m))
    .map(m => {
      const text = textOf(m.content).trim();
      switch (typeOf(m)) {
        case "human":
          return isCompactSummary(m)
            ? `[Summary of the conversation before this point]\n${text.replace(SUMMARY_HEADER, "").trim()}`
            : isClient(m)
              ? `User: ${text}`
              : `Note to the assistant: ${clip(text, TRANSCRIPT_PART_CHARS)}`;
        case "ai": {
          const calls = ((m as AIMessage).tool_calls ?? []).map(
            c =>
              `Assistant called ${c.name}(${clip(stringify(c.args), TRANSCRIPT_PART_CHARS)})`
          );
          return [text ? `Assistant: ${text}` : "", ...calls]
            .filter(Boolean)
            .join("\n");
        }
        case "tool":
          return `Result of ${m.name ?? "the tool"}: ${clip(text, TRANSCRIPT_PART_CHARS)}`;
        case "system":
          return text ? `System note: ${text}` : "";
        default:
          return text;
      }
    })
    .filter(Boolean)
    .join("\n\n");
}

export const AUTO_COMPACT_INSTRUCTIONS =
  "You write the summary that replaces the earlier part of a conversation between a user and an AI assistant. " +
  "The assistant continues from your summary alone: the original messages will be gone. Keep everything it needs to " +
  "go on without asking again: who the user is and what they want; facts, names, numbers, ids, links, prices and dates " +
  "given or found; what was decided, promised or agreed; the user's preferences and corrections; what was done with " +
  "tools and what came of it; questions left open and work in progress. Leave out greetings and repetition. Write in " +
  "the language of the conversation, as compact notes. Do not answer the user and do not call any tool: write the " +
  "summary only.";

/** Anything with `invoke`: a chat model, with or without tools bound. */
export interface SummaryModel {
  invoke(input: BaseMessage[], options?: RunnableConfig): Promise<unknown>;
}

export interface AutoCompactOptions extends MessageKinds {
  settings: ResolvedAutoCompactSettings | null;
  /** Writes the summary. A model with no tools bound is best. */
  model: SummaryModel | (() => Promise<SummaryModel>);
  /** The node's config: the summary call shows in the trace and is billed, and is kept off the client's stream. */
  config?: RunnableConfig;
  /** Told when the summary could not be written; the history then stays as it is. */
  onError?: (error: unknown) => void;
}

export interface AutoCompactResult {
  /** The history to send the model now: the summary, then the kept turns. */
  messages: BaseMessage[];
  /** For a `messagesStateReducer` channel: replaces the stored history with `messages`. */
  stateUpdate: BaseMessage[];
  summary: string;
  summarizedMessages: number;
  tokensBefore: number;
  tokensAfter: number;
}

/** Tag that keeps a model call off the client's stream (the call is still traced and billed). */
export const NO_STREAM_TAG = "nostream";

/**
 * Compacts the history when `planCompaction` says so; null otherwise. A summarizer that fails or returns nothing
 * leaves the history as it is: the turn is answered uncompacted and the next turn tries again.
 */
export async function autoCompact(
  messages: BaseMessage[],
  options: AutoCompactOptions
): Promise<AutoCompactResult | null> {
  if (!options.settings) return null;
  const plan = planCompaction(messages, options.settings, options);
  if (!plan) return null;
  const instructions = options.settings.instructions
    ? `${AUTO_COMPACT_INSTRUCTIONS}\n\nAlso keep: ${options.settings.instructions}`
    : AUTO_COMPACT_INSTRUCTIONS;
  const config = options.config ?? {};
  let response: unknown;
  try {
    const model =
      typeof options.model === "function"
        ? await options.model()
        : options.model;
    response = await model.invoke(
      [
        new SystemMessage(instructions),
        new HumanMessage(
          `<conversation>\n${renderTranscript(plan.head, options)}\n</conversation>\n\nWrite the summary now.`
        ),
      ],
      {
        ...config,
        runName: "auto_compact",
        tags: [...(config.tags ?? []), NO_STREAM_TAG, "auto_compact"],
        metadata: { ...(config.metadata ?? {}), auto_compact: true },
      }
    );
  } catch (error) {
    options.onError?.(error);
    return null;
  }
  const summary = textOf((response as BaseMessage | undefined)?.content).trim();
  if (!summary) return null;
  const summaryMessage = new HumanMessage({
    content: `${SUMMARY_HEADER}\n\n${summary}`,
    additional_kwargs: { [SUMMARY_MARK]: true },
  });
  const compacted = [summaryMessage, ...plan.tail.map(keptCopy)];
  return {
    messages: compacted,
    stateUpdate: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), ...compacted],
    summary,
    summarizedMessages: plan.head.length,
    tokensBefore: plan.tokens,
    tokensAfter: compacted.reduce(
      (sum, m) => sum + estimateMessageTokens(m),
      0
    ),
  };
}
