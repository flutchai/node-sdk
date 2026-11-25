import type { BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  autoCompact,
  resolveAutoCompactSettings,
  type AutoCompactResult,
  type MessageKinds,
  type SummaryModel,
} from "../messages/auto-compact";

/**
 * What a graph tells the SDK about its history for the agent's auto-compaction. A builder returns it from
 * `threadCompaction`; null means its state keeps no history worth compacting.
 */
export interface ThreadCompactionHooks extends MessageKinds {
  /** What the summary must also keep for this graph, added before the agent's own instructions. */
  instructions?: string;
  /** The graph's own ceiling on the history: compaction starts below it, whatever the agent's threshold. */
  maxTriggerTokens?: number;
  /** The model that writes the summary when the agent names none; `graphSettings.modelId` otherwise. */
  modelId?: string;
}

export interface CompactThreadOptions extends ThreadCompactionHooks {
  /** The agent's `threadSettings.autoCompact`, as the platform sent it. */
  settings: unknown;
  /** Creates the summarizer for a model id from the catalog. */
  createModel: (modelId: string) => Promise<SummaryModel>;
  onError?: (error: unknown) => void;
}

export interface CompactedThreadInput {
  /** The run's input with the rewrite of the history before its own messages. */
  input: Record<string, unknown>;
  result: AutoCompactResult;
}

/** The agent's auto-compaction settings a run carries (`configurable.threadSettings.autoCompact`). */
export const threadCompactSettingsOf = (config: RunnableConfig | undefined) =>
  (config?.configurable?.threadSettings as Record<string, unknown> | undefined)
    ?.autoCompact;

interface StateReader {
  getState(config: RunnableConfig): Promise<{
    values?: { messages?: unknown };
    next?: readonly string[];
    tasks?: ReadonlyArray<{ interrupts?: readonly unknown[] }>;
  }>;
}

const hasStateReader = (graph: unknown): graph is StateReader =>
  !!graph && typeof (graph as StateReader).getState === "function";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && value.constructor === Object;

/**
 * Compacts a thread before a run starts: reads the thread's last checkpoint and, when its history with the run's
 * new messages crosses the agent's threshold, returns the input with the history's rewrite in front — the state is
 * replaced in the same write that adds the new messages. Null when nothing is to be done: auto-compaction off, a
 * resumed or parked run, a graph without a message history, below the threshold, or the summary failed.
 */
export async function compactThreadInput(
  graph: unknown,
  input: unknown,
  config: RunnableConfig,
  options: CompactThreadOptions
): Promise<CompactedThreadInput | null> {
  const resolved = resolveAutoCompactSettings(options.settings);
  if (!resolved || !hasStateReader(graph) || !isPlainObject(input)) return null;
  const incoming = input.messages;
  if (!Array.isArray(incoming) || !incoming.length) return null;

  const threadId = config.configurable?.thread_id;
  if (!threadId) return null;
  // The root graph's checkpoints live under the default namespace whatever the run's checkpoint_ns.
  const snapshot = await graph.getState({
    configurable: { thread_id: threadId },
  });
  const history = snapshot?.values?.messages;
  if (!Array.isArray(history) || !history.length) return null;
  if (snapshot.next?.length) return null;
  if (snapshot.tasks?.some(task => task.interrupts?.length)) return null;

  const triggerTokens = options.maxTriggerTokens
    ? Math.min(resolved.triggerTokens, options.maxTriggerTokens)
    : resolved.triggerTokens;
  const instructions =
    [options.instructions, resolved.instructions]
      .filter(Boolean)
      .join("\n\n") || undefined;
  const modelId =
    resolved.modelId ??
    options.modelId ??
    (config.configurable?.graphSettings as { modelId?: string } | undefined)
      ?.modelId;
  if (!modelId) return null;

  const result = await autoCompact(
    [...(history as BaseMessage[]), ...(incoming as BaseMessage[])],
    {
      settings: { ...resolved, triggerTokens, instructions },
      model: () => options.createModel(modelId),
      config,
      isHidden: options.isHidden,
      isClientMessage: options.isClientMessage,
      onError: options.onError,
    }
  );
  if (!result) return null;
  return { input: { ...input, messages: result.stateUpdate }, result };
}
