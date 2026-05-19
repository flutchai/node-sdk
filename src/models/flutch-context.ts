import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context propagated from the graph entry point down to the
 * HTTP layer of every LLM call made through the Flutch router.
 *
 * Used by `flutchFetch` to inject X-Flutch-* headers so that the router can
 * forward them to the backend usage webhook, which in turn attaches them to
 * the balance audit row created for the request.
 */
export interface FlutchContext {
  messageId?: string;
  threadId?: string;
  agentId?: string;
  userId?: string;
  nodeName?: string;
}

const als = new AsyncLocalStorage<FlutchContext>();

/**
 * Run `fn` with the given Flutch context attached to the current async chain.
 * Any LLM call made through a model initialized via `ModelInitializer` while
 * `fn` is on the call stack will carry the corresponding X-Flutch-* headers.
 */
export function withFlutchContext<T>(ctx: FlutchContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getFlutchContext(): FlutchContext | undefined {
  return als.getStore();
}

const HEADER_MAP: Record<keyof FlutchContext, string> = {
  messageId: "x-flutch-message-id",
  threadId: "x-flutch-thread-id",
  agentId: "x-flutch-agent-id",
  userId: "x-flutch-user-id",
  nodeName: "x-flutch-node",
};

/**
 * Drop-in replacement for global `fetch` that injects X-Flutch-* headers
 * from the current AsyncLocalStorage context. Safe to use as a static
 * dependency of cached model instances — the context is read lazily, at
 * the moment of the actual HTTP call.
 */
export const flutchFetch: typeof fetch = (input, init) => {
  const ctx = als.getStore();
  if (!ctx) {
    return fetch(input, init);
  }

  const headers = new Headers(init?.headers);
  for (const key of Object.keys(HEADER_MAP) as (keyof FlutchContext)[]) {
    const value = ctx[key];
    if (value) {
      headers.set(HEADER_MAP[key], String(value));
    }
  }

  return fetch(input, { ...init, headers });
};

/**
 * Returns the X-Flutch-* headers for the current ALS context. Used by SDK
 * integrations whose underlying HTTP client doesn't accept a custom `fetch`
 * (Cohere `fetcher` arg, Mistral `beforeRequestHooks`, ...).
 *
 * Returns an empty object if no FlutchContext is installed.
 */
export function flutchHeaders(): Record<string, string> {
  const ctx = als.getStore();
  if (!ctx) return {};
  const out: Record<string, string> = {};
  for (const key of Object.keys(HEADER_MAP) as (keyof FlutchContext)[]) {
    const value = ctx[key];
    if (value) {
      out[HEADER_MAP[key]] = String(value);
    }
  }
  return out;
}

/**
 * beforeRequestHook for `@langchain/mistralai` / `@mistralai/mistralai`.
 * Mutates the outgoing Request to add X-Flutch-* headers from the current
 * ALS context.
 */
export function flutchMistralHook(req: Request): Request {
  const extras = flutchHeaders();
  if (Object.keys(extras).length === 0) {
    return req;
  }
  const headers = new Headers(req.headers);
  for (const [k, v] of Object.entries(extras)) {
    headers.set(k, v);
  }
  return new Request(req, { headers });
}

/**
 * Wraps a Cohere `FetchFunction` with one that injects X-Flutch-* headers
 * from the current ALS context into `args.headers`. Pass the result to
 * `new CohereClient({ fetcher: ... })`.
 *
 * The argument shape (`Fetcher.Args`) is provider-specific; we deliberately
 * type it as `any` to avoid a hard dependency on `cohere-ai` types from
 * this file.
 */
export function wrapCohereFetcher<T extends (args: any) => any>(inner: T): T {
  return ((args: any) => {
    const extras = flutchHeaders();
    if (Object.keys(extras).length === 0) {
      return inner(args);
    }
    return inner({
      ...args,
      headers: { ...(args.headers ?? {}), ...extras },
    });
  }) as T;
}
