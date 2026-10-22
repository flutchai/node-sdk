import { TOOL_SEARCH_NAME, parseToolSearchResult } from "./tool-search.result";

interface AnthropicBlock {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  content?: unknown;
}

interface AnthropicBody {
  tools?: { name?: string }[];
  messages?: { role?: string; content?: unknown }[];
}

/**
 * Turns `search_tools` results into `tool_reference` blocks in an Anthropic
 * Messages request.
 *
 * With deferred tools (`defer_loading: true`) Claude sees a tool only after a
 * `tool_result` names it with a `tool_reference` block; the API then expands
 * the reference into the full definition. The prefix of the request is
 * untouched, so the prompt cache survives a search. LangChain drops
 * `tool_reference` blocks when it formats a ToolMessage, so the graph keeps
 * the result as JSON text in its history and the blocks are put in here, on
 * the wire, every time the history is sent — the same history always gives
 * the same request.
 *
 * Rules the API enforces (checked on Bedrock InvokeModel and the Claude API):
 * a `tool_result` that carries references holds nothing else, and every
 * referenced name must be in `tools`. A result that names no known tool is
 * left as text ("no tools matched").
 *
 * Returns the body unchanged (same string) when there is nothing to rewrite.
 */
export function rewriteToolReferences(body: string): string {
  // Cheap guard: almost every request has no search in it.
  if (!body.includes(TOOL_SEARCH_NAME)) return body;

  let parsed: AnthropicBody;
  try {
    parsed = JSON.parse(body) as AnthropicBody;
  } catch {
    return body;
  }

  const known = new Set((parsed.tools ?? []).map(tool => tool.name));
  const searchIds = new Set<string>();
  for (const message of parsed.messages ?? []) {
    if (message.role !== "assistant" || !Array.isArray(message.content))
      continue;
    for (const block of message.content as AnthropicBlock[]) {
      if (
        block.type === "tool_use" &&
        block.name === TOOL_SEARCH_NAME &&
        block.id
      ) {
        searchIds.add(block.id);
      }
    }
  }
  if (searchIds.size === 0) return body;

  let changed = false;
  for (const message of parsed.messages ?? []) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const block of message.content as AnthropicBlock[]) {
      if (block.type !== "tool_result" || !block.tool_use_id) continue;
      if (!searchIds.has(block.tool_use_id)) continue;
      const names = parseToolSearchResult(block.content).filter(name =>
        known.has(name)
      );
      if (names.length === 0) continue;
      block.content = names.map(name => ({
        type: "tool_reference",
        tool_name: name,
      }));
      changed = true;
    }
  }
  return changed ? JSON.stringify(parsed) : body;
}

/** A `fetch` that applies `rewriteToolReferences` to JSON request bodies. */
export function withToolReferences(inner: typeof fetch): typeof fetch {
  return (input, init) => {
    if (init && typeof init.body === "string") {
      const body = rewriteToolReferences(init.body);
      if (body !== init.body) return inner(input, { ...init, body });
    }
    return inner(input, init);
  };
}
