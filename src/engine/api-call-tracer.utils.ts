import * as LangGraph from "@langchain/langgraph";
import { Logger } from "@nestjs/common";

const logger = new Logger("ApiCallTracer");

const MAX_STRING_LENGTH = 5000; // Increased to avoid truncating long content
const MAX_COLLECTION_LENGTH = 50; // Increased to handle multiple tool calls
const MAX_DEPTH = 15; // Deep enough for LangChain structures, shallow enough to prevent infinite loops

type LangGraphDispatchFn = (
  eventName: string,
  payload?: Record<string, unknown>
) => void;

let cachedDispatch: LangGraphDispatchFn | null | undefined;
let dispatchUnavailableLogged = false;

export interface TraceApiCallResult<TResult> {
  /** Result returned from the wrapped API call */
  result: TResult;
  /** Unix timestamp in milliseconds when the call started */
  startedAt: number;
  /** Unix timestamp in milliseconds when the call completed */
  completedAt: number;
  /** Milliseconds spent inside the API call */
  durationMs: number;
}

export async function traceApiCall<TResult>(
  execute: () => Promise<TResult>
): Promise<TraceApiCallResult<TResult>> {
  const startedAt = Date.now();

  dispatchApiTraceEvent("custom_api_call_start");

  try {
    const result = await execute();
    const completedAt = Date.now();
    const durationMs = completedAt - startedAt;

    dispatchApiTraceEvent("custom_api_call_end", {
      result: sanitizeTraceData(result),
      startedAt,
      completedAt,
      durationMs,
    });

    return { result, startedAt, completedAt, durationMs };
  } catch (error) {
    const failedAt = Date.now();
    const durationMs = failedAt - startedAt;

    dispatchApiTraceEvent("custom_api_call_error", {
      error: sanitizeTraceError(error),
      startedAt,
      failedAt,
      durationMs,
    });

    throw error;
  }
}

function dispatchApiTraceEvent(
  eventName: string,
  payload?: Record<string, unknown>
): void {
  const dispatch = getLangGraphDispatch();

  if (!dispatch) {
    if (!dispatchUnavailableLogged) {
      logger.debug("LangGraph dispatchCustomEvent is not available");
      dispatchUnavailableLogged = true;
    }
    return;
  }

  try {
    dispatch(eventName, payload);
  } catch (error) {
    logger.warn("Failed to emit API trace event", {
      error: error instanceof Error ? error.message : String(error),
      eventName,
    });
  }
}

function getLangGraphDispatch(): LangGraphDispatchFn | null {
  if (cachedDispatch !== undefined) {
    return cachedDispatch;
  }

  const { dispatchCustomEvent } = LangGraph as unknown as {
    dispatchCustomEvent?: LangGraphDispatchFn;
  };

  cachedDispatch =
    typeof dispatchCustomEvent === "function" ? dispatchCustomEvent : null;

  return cachedDispatch;
}

export function sanitizeTraceData(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…`
      : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return sanitizeTraceError(value);
  }

  if (depth >= MAX_DEPTH) {
    return Array.isArray(value) ? "[Array]" : "[Object]";
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) {
      // Skip circular references instead of returning "[Circular]" string
      return undefined;
    }

    seen.add(value as object);

    if (Array.isArray(value)) {
      // Don't truncate arrays - we need all tool calls, all messages, etc.
      return value
        .map(item => sanitizeTraceData(item, depth + 1, seen))
        .filter(item => item !== undefined); // Remove circular refs from array
    }

    if (value instanceof Set) {
      return Array.from(value)
        .map(item => sanitizeTraceData(item, depth + 1, seen))
        .filter(item => item !== undefined);
    }

    if (value instanceof Map) {
      const entries: Record<string, unknown> = {};
      for (const [key, entryValue] of value.entries()) {
        const sanitized = sanitizeTraceData(entryValue, depth + 1, seen);
        if (sanitized !== undefined) {
          entries[String(key)] = sanitized;
        }
      }
      return entries;
    }

    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(
      value as Record<string, unknown>
    )) {
      const sanitized = sanitizeTraceData(entryValue, depth + 1, seen);
      // Skip circular references instead of adding "[Circular]" string
      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }
    return result;
  }

  return String(value);
}

function sanitizeTraceError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ? sanitizeTraceData(error.stack) : undefined,
    };
  }

  if (typeof error === "string") {
    return {
      message:
        error.length > MAX_STRING_LENGTH
          ? `${error.slice(0, MAX_STRING_LENGTH)}…`
          : error,
    };
  }

  return {
    message: "Unknown error",
    raw: sanitizeTraceData(error),
  };
}
