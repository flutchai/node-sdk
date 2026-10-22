import type { BaseMessage } from "@langchain/core/messages";
import type { ToolSearchHit } from "./tool-search.catalog";

/** Name of the tool the model calls to find the tools it does not see yet. */
export const TOOL_SEARCH_NAME = "search_tools";

/** Is this tool call a tool search? Graphs route it to `ModelInitializer.searchTools`. */
export function isToolSearchCall(name: string | undefined): boolean {
  return name === TOOL_SEARCH_NAME;
}

/**
 * The search result the model reads, and the record of which tools a
 * conversation has loaded: `{"tools":[{"name","description"}]}`.
 *
 * The same JSON serves every provider. Models bound per turn read it as
 * text; for Claude, the request is rewritten so the API expands these names
 * into full tool definitions (see `tool-reference.fetch.ts`).
 */
export function formatToolSearchResult(hits: ToolSearchHit[]): string {
  if (hits.length === 0) {
    return JSON.stringify({
      tools: [],
      note: "No tools matched. Search again with other words: what the tool does, the object it works on, or a name prefix.",
    });
  }
  return JSON.stringify({
    tools: hits,
    note: "These tools are available now. Call them directly.",
  });
}

/** Tool names in one search result; an unreadable result names none. */
export function parseToolSearchResult(content: unknown): string[] {
  const text = contentText(content);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { tools?: { name?: unknown }[] };
    return (parsed.tools ?? [])
      .map(tool => tool?.name)
      .filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map(part =>
        typeof part === "string"
          ? part
          : part && typeof part === "object" && "text" in part
            ? String((part as { text: unknown }).text)
            : ""
      )
      .join("");
  }
  return "";
}

/**
 * Tools the conversation has found so far, in the order they were first
 * found. Read from the history itself — the search results stay in the
 * thread — so no graph needs extra state, and a restarted pod sees the same
 * set.
 */
export function loadedToolNames(messages: BaseMessage[]): string[] {
  const searchCallIds = new Set<string>();
  for (const message of messages) {
    const calls = (message as { tool_calls?: { id?: string; name?: string }[] })
      .tool_calls;
    for (const call of calls ?? []) {
      if (isToolSearchCall(call.name) && call.id) searchCallIds.add(call.id);
    }
  }

  const loaded: string[] = [];
  for (const message of messages) {
    if (message._getType() !== "tool") continue;
    const tool = message as BaseMessage & {
      name?: string;
      tool_call_id?: string;
    };
    const isSearch =
      isToolSearchCall(tool.name) ||
      (tool.tool_call_id !== undefined && searchCallIds.has(tool.tool_call_id));
    if (!isSearch) continue;
    for (const name of parseToolSearchResult(tool.content)) {
      if (!loaded.includes(name)) loaded.push(name);
    }
  }
  return loaded;
}
