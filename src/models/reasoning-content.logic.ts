/**
 * Sanitizing of assistant reasoning ("thinking") blocks on the way OUT to
 * Bedrock Converse. Pure logic — no I/O, no DI.
 *
 * ## The bug this exists for
 *
 * Claude Opus 5 (and the rest of the adaptive-thinking generation) returns its
 * reasoning **opaquely**: the Converse stream carries a single
 * `contentBlockDelta.delta.reasoningContent` that holds only a `signature` —
 * no `text`, no `redactedContent`. Verified against
 * `us.anthropic.claude-opus-5` in us-east-2:
 *
 *   REASONING DELTA keys: [ 'signature' ] | text: undefined | redacted: undefined
 *
 * `@langchain/aws` maps that to `{ type: "reasoning_content",
 * reasoningText: { signature } }` and, when the message is sent back as
 * history, hands `reasoningText` to Bedrock **verbatim**
 * (`langchainReasoningBlockToBedrockReasoningBlock`). The Converse *request*
 * schema requires `reasoningContent.reasoningText.text` to be non-null, so the
 * whole request is rejected:
 *
 *   ValidationException: Value at
 *   'messages.N.member.content.M.member.reasoningContent.reasoningText.text'
 *   failed to satisfy constraint: Member must not be null
 *
 * Every multi-step (tool-calling) conversation therefore died on the second
 * model call — the first call succeeds, the continuation after the tool result
 * always fails.
 *
 * ## Why the block is dropped rather than converted
 *
 * Three repair strategies were tried against live Bedrock with a real
 * signature-only block (see CHANGELOG 0.6.5):
 *
 *   - `reasoningContent.redactedContent = <signature bytes>` → **rejected**:
 *     `Invalid \`data\` in \`redacted_thinking\` block`. `redactedContent` is a
 *     different, service-encrypted payload; a signature is not a substitute and
 *     cannot be fabricated.
 *   - `reasoningText: { text: "", signature }` → accepted today, but it
 *     silently *modifies a signed block*, which providers are explicitly
 *     allowed to reject.
 *   - dropping the block → accepted, and the model answers normally.
 *
 * So the rule is: a reasoning block we cannot represent on the wire is removed.
 * Nothing else about the message changes — text blocks, tool_use blocks and
 * `tool_calls` all survive, which is what keeps the post-tool continuation
 * working.
 *
 * The one exception is the degenerate case where dropping would leave the
 * assistant message with *no* content at all and no tool calls (a turn that was
 * cut off mid-thinking). An empty `content: []` is itself rejected by Bedrock,
 * so there the block is kept in the normalized `{ text: "", signature }` form —
 * the least-bad option, and empirically accepted.
 *
 * ## Scope
 *
 * The transformation is defined purely by "would Bedrock's request schema
 * reject this block", so it is model-agnostic and a no-op for every history
 * that does not contain a malformed reasoning block: sonnet-4.5/4.6, haiku and
 * every non-thinking model return the exact same array instance they passed in.
 */

import type { BaseMessage } from "@langchain/core/messages";

/** Shape of a LangChain reasoning block as produced by `@langchain/aws`. */
export interface LangchainReasoningBlock {
  type: "reasoning_content";
  reasoningText?: {
    text?: string | null;
    signature?: string | null;
  } | null;
  redactedContent?: string | null;
}

type ContentBlock = Record<string, unknown>;

/** Is this content block an assistant reasoning block? */
export function isReasoningBlock(
  block: unknown
): block is LangchainReasoningBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as ContentBlock).type === "reasoning_content"
  );
}

/**
 * Can this reasoning block be sent back to Bedrock as-is?
 *
 * Valid forms:
 *   - `reasoningText.text` is a non-empty string (regular exposed thinking)
 *   - `redactedContent` is a non-empty string (service-encrypted thinking)
 *
 * Everything else — a `reasoningText` with a null / undefined / empty `text`,
 * an empty `reasoningText`, a missing payload — is rejected by the Converse
 * request schema.
 */
export function isSendableReasoningBlock(
  block: LangchainReasoningBlock
): boolean {
  if (typeof block.redactedContent === "string" && block.redactedContent !== "")
    return true;

  const text = block.reasoningText?.text;
  return typeof text === "string" && text !== "";
}

/**
 * Last-resort form for a block that must stay (otherwise the message would be
 * empty): keep the signature, give the schema the non-null `text` it demands.
 * Returns `null` when there is not even a signature to preserve.
 */
function normalizeUnsendableBlock(
  block: LangchainReasoningBlock
): LangchainReasoningBlock | null {
  const signature = block.reasoningText?.signature;
  if (typeof signature !== "string" || signature === "") return null;
  return { type: "reasoning_content", reasoningText: { text: "", signature } };
}

/** Does this message carry tool calls that must survive sanitizing? */
function hasToolCalls(message: BaseMessage): boolean {
  const toolCalls = (message as { tool_calls?: unknown[] }).tool_calls;
  return Array.isArray(toolCalls) && toolCalls.length > 0;
}

/**
 * Clone a message with new content, preserving its class, `tool_calls`,
 * `response_metadata`, ids and every other field.
 *
 * Reconstructing through the constructor is avoided on purpose: `AIMessageChunk`
 * re-derives `tool_calls` from `tool_call_chunks`, which would rewrite (and can
 * lose) tool calls. Cloning the prototype + own properties keeps the message
 * byte-identical apart from `content`.
 */
function withContent(message: BaseMessage, content: unknown[]): BaseMessage {
  const clone = Object.assign(
    Object.create(Object.getPrototypeOf(message)) as BaseMessage,
    message,
    { content }
  ) as BaseMessage & { lc_kwargs?: Record<string, unknown> };

  // Keep the serialization payload in sync so a clone that does get persisted
  // does not resurrect the malformed content.
  if (clone.lc_kwargs) clone.lc_kwargs = { ...clone.lc_kwargs, content };

  return clone;
}

/**
 * Sanitize one message. Returns the **same instance** when nothing needs to
 * change, so callers can cheaply detect a no-op.
 */
export function sanitizeMessageReasoning(message: BaseMessage): BaseMessage {
  // Reasoning blocks only ever appear on assistant turns; leave user and tool
  // messages strictly alone.
  if (message.getType() !== "ai") return message;

  const content = message.content;
  if (!Array.isArray(content)) return message;

  const unsendable = content.filter(
    block => isReasoningBlock(block) && !isSendableReasoningBlock(block)
  );
  if (unsendable.length === 0) return message;

  const kept = content.filter(block => !unsendable.includes(block));

  // Dropping everything would produce `content: []`, which Bedrock rejects on
  // its own. Keep the last salvageable block in normalized form instead.
  if (kept.length === 0 && !hasToolCalls(message)) {
    for (let i = unsendable.length - 1; i >= 0; i--) {
      const normalized = normalizeUnsendableBlock(
        unsendable[i] as LangchainReasoningBlock
      );
      if (normalized) return withContent(message, [normalized]);
    }
  }

  return withContent(message, kept);
}

export interface SanitizedHistory {
  /** History safe to hand to Bedrock. Same instance when nothing changed. */
  messages: BaseMessage[];
  /** How many reasoning blocks were removed or normalized (for logging). */
  sanitized: number;
}

/**
 * Sanitize a whole outgoing history.
 *
 * Idempotent, allocation-free on the happy path: a history without malformed
 * reasoning blocks comes back as the very same array.
 */
export function sanitizeReasoningForBedrock(
  messages: BaseMessage[]
): SanitizedHistory {
  let sanitized = 0;
  let next: BaseMessage[] | undefined;

  for (let i = 0; i < messages.length; i++) {
    const cleaned = sanitizeMessageReasoning(messages[i]);
    if (cleaned === messages[i]) continue;

    if (!next) next = [...messages];
    next[i] = cleaned;

    const before = (messages[i].content as unknown[]).length;
    const after = (cleaned.content as unknown[]).length;
    sanitized += Math.max(1, before - after);
  }

  return { messages: next ?? messages, sanitized };
}
