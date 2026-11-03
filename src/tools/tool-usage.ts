/**
 * What a tool call cost, in the shape LangSmith reads off any run
 * (https://docs.langchain.com/langsmith/cost-tracking, "Other runs"):
 * `usage_metadata: { total_cost }`, USD. A paid tool puts it beside its
 * result; the SDK takes it out of what the model and the client see and keeps
 * it on the call's end event, where the backend reads it from the trace.
 */
export interface IToolUsageMetadata {
  /** USD this call cost: the provider's price, or the sum of the paid calls the tool made. */
  total_cost: number;
}

/** A tool's end-event output with its cost: what the client shows is `content`. */
export interface IToolEndOutput {
  content: string;
  usage_metadata: IToolUsageMetadata;
}

/** A usable cost, or undefined: a number ≥ 0 under `total_cost`. */
export function toolUsageOf(value: unknown): IToolUsageMetadata | undefined {
  const cost = (value as { total_cost?: unknown } | null | undefined)
    ?.total_cost;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0
    ? { total_cost: cost }
    : undefined;
}

/**
 * What to pass to `handleToolEnd`: the content alone when the call cost
 * nothing known, the content with its cost otherwise.
 */
export function toolEndOutput(
  content: string,
  usage?: IToolUsageMetadata
): string | IToolEndOutput {
  return usage ? { content, usage_metadata: usage } : content;
}

/** The text of a tool end output that carries a cost; undefined for any other output. */
export function toolEndContent(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const o = output as {
    content?: unknown;
    usage_metadata?: unknown;
    artifact?: { usage_metadata?: unknown };
  };
  if (typeof o.content !== "string") return undefined;
  return toolUsageOf(o.usage_metadata) ||
    toolUsageOf(o.artifact?.usage_metadata)
    ? o.content
    : undefined;
}
