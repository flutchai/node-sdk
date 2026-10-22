import { DynamicStructuredTool, StructuredTool } from "@langchain/core/tools";
import { Runnable, RunnableLambda } from "@langchain/core/runnables";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { ToolSearchCatalog } from "./tool-search.catalog";
import {
  TOOL_SEARCH_NAME,
  formatToolSearchResult,
  loadedToolNames,
} from "./tool-search.result";

/** Agent setting: find tools on demand instead of seeing all of them. */
export interface ToolSearchOptions {
  /** Off unless set. */
  enabled?: boolean;
  /**
   * Tools the model always sees, by name. Keep the 3–5 used in almost every
   * conversation here; the rest are found through `search_tools`. A
   * comma-separated string is accepted too (what a settings form stores).
   */
  alwaysLoaded?: string[] | string;
  /** Tools one search returns. Default 5. */
  maxResults?: number;
  /**
   * Below this many tools search is not worth a step: every tool is bound
   * as before. Default 15.
   */
  minTools?: number;
}

export const DEFAULT_TOOL_SEARCH_RESULTS = 5;
export const DEFAULT_TOOL_SEARCH_MIN_TOOLS = 15;

/**
 * How found tools reach the model.
 *
 * - `deferred` — Claude through the Anthropic Messages API (the router and
 *   Bedrock InvokeModel included): every tool is sent with
 *   `defer_loading: true`, and the API loads the ones a search names.
 *   The prompt cache survives a search.
 * - `rebind` — any other model (Bedrock Converse, OpenAI, Mistral…): each
 *   turn binds the core tools plus the ones the history has found. The
 *   first turn after a search misses the prompt cache once.
 */
export type ToolSearchMode = "deferred" | "rebind";

/** Is tool search on for these options and this many tools? */
export function toolSearchApplies(
  options: ToolSearchOptions | undefined,
  toolCount: number
): options is ToolSearchOptions {
  return (
    !!options?.enabled &&
    toolCount >= (options.minTools ?? DEFAULT_TOOL_SEARCH_MIN_TOOLS)
  );
}

/**
 * Splits tools into the ones always bound and the ones found by search.
 * `extraCore` are tools the graph itself adds (its custom tools): the graph
 * relies on them, so they are never hidden.
 */
export function splitTools(
  tools: StructuredTool[],
  options: ToolSearchOptions,
  extraCore: StructuredTool[] = []
): { core: StructuredTool[]; deferred: StructuredTool[] } {
  const listed =
    typeof options.alwaysLoaded === "string"
      ? options.alwaysLoaded.split(",")
      : (options.alwaysLoaded ?? []);
  const always = new Set([
    ...listed.map(name => name.trim()).filter(Boolean),
    ...extraCore.map(tool => tool.name),
  ]);
  return {
    core: tools.filter(tool => always.has(tool.name)),
    deferred: tools.filter(tool => !always.has(tool.name)),
  };
}

/**
 * The `search_tools` tool. Its description lists what the catalog covers, so
 * the model knows a search is worth making. Graphs run it through
 * `ModelInitializer.searchTools`; `func` is there for graphs that invoke
 * bound tools directly.
 */
export function createToolSearchTool(
  catalog: ToolSearchCatalog,
  maxResults = DEFAULT_TOOL_SEARCH_RESULTS
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: TOOL_SEARCH_NAME,
    description:
      `Find more tools. You see only some of your tools; ${catalog.size} more are found by search: ` +
      `${catalog.summary()}. ` +
      'Describe the task in a few words (what to do and with what, e.g. "customer review quotes by theme"), ' +
      "or give exact tool names. Found tools become callable right away and stay available for the rest of the conversation. " +
      "Search before saying you cannot do something.",
    schema: z.object({
      query: z
        .string()
        .describe(
          "What the tool should do, in a few words, or tool names separated by commas"
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe(`How many tools to return (default ${maxResults})`),
    }),
    func: async ({ query, limit }) =>
      formatToolSearchResult(catalog.search(query, limit ?? maxResults)),
  });
}

/** A copy of a tool marked `defer_loading` for the Anthropic API. */
function deferredCopy(tool: StructuredTool): StructuredTool {
  const copy = Object.create(tool) as StructuredTool;
  copy.extras = { ...(tool.extras ?? {}), defer_loading: true };
  return copy;
}

type BindOptions = Parameters<BaseChatModel["bindTools"]>[1];

/**
 * A model with tool search: `search_tools` + the core tools up front, the
 * rest found on demand. Same call surface as `model.bindTools(...)`.
 */
export function bindToolsWithSearch(params: {
  model: BaseChatModel;
  core: StructuredTool[];
  deferred: StructuredTool[];
  searchTool: StructuredTool;
  mode: ToolSearchMode;
  bindOptions?: BindOptions;
}): Runnable {
  const { model, core, deferred, searchTool, mode, bindOptions } = params;
  const bind = (tools: StructuredTool[]) =>
    bindOptions
      ? model.bindTools!(tools, bindOptions)
      : model.bindTools!(tools);

  if (mode === "deferred") {
    // One fixed tool list for the whole conversation: the cache key of the
    // request prefix never changes, whatever the model finds.
    return bind([searchTool, ...core, ...deferred.map(deferredCopy)]);
  }

  // Core first, search next, found tools after them in the order found: a
  // later search only appends, so the start of the tool list stays stable.
  const byName = new Map(deferred.map(tool => [tool.name, tool]));
  const bound = new Map<string, Runnable>();
  const forHistory = (messages: BaseMessage[]): Runnable => {
    const found = loadedToolNames(messages).filter(name => byName.has(name));
    const key = found.join(",");
    let runnable = bound.get(key);
    if (!runnable) {
      runnable = bind([
        ...core,
        searchTool,
        ...found.map(name => byName.get(name)!),
      ]);
      bound.set(key, runnable);
    }
    return runnable;
  };

  return RunnableLambda.from(async (input: unknown, config) => {
    const messages = Array.isArray(input) ? (input as BaseMessage[]) : [];
    return forHistory(messages).invoke(input as BaseMessage[], config);
  }).withConfig({ runName: "ToolSearchModel" });
}
