import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context propagated from the graph entry point down to the
 * HTTP layer of every LLM call made through the Flutch router.
 *
 * `agentId` is the canonical routing key in SaaS / internal trust mode
 * (see {@link isInternalMode}): the router forwards it to the backend
 * usage webhook, which resolves agent → company → account and bills the
 * resolved account. The other fields are audit metadata stamped onto
 * the resulting balance_audit row so charges can be grouped by message
 * / thread / user / node.
 *
 * In OSS mode (no FLUTCHROUTER_INTERNAL_TOKEN), the router authenticates
 * the bearer flutch_* token and ignores these headers for billing —
 * they remain available as audit metadata only.
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

const INTERNAL_TOKEN_HEADER = "x-flutch-internal-token";

/**
 * True when this process is configured as the trusted SaaS backend (or
 * any other internal caller sharing the router's internal secret). The
 * SDK switches into SaaS auth mode for every router-bound request:
 * X-Flutch-Internal-Token is sent alongside X-Flutch-Agent-Id (the
 * routing key the router forwards to backend for agent→company→account
 * resolution), and the router uses those headers instead of looking up
 * the bearer token.
 *
 * Driven by FLUTCHROUTER_INTERNAL_TOKEN env var — same shared secret the
 * router validates against. Empty / unset → OSS mode (Bearer flutch_*).
 */
export function isInternalMode(): boolean {
  return !!process.env.FLUTCHROUTER_INTERNAL_TOKEN;
}

function internalToken(): string | undefined {
  const v = process.env.FLUTCHROUTER_INTERNAL_TOKEN;
  return v && v.length > 0 ? v : undefined;
}

/**
 * Drop-in replacement for global `fetch` that injects X-Flutch-* headers
 * from the current AsyncLocalStorage context. Safe to use as a static
 * dependency of cached model instances — the context (and the env-driven
 * internal token) is read lazily, at the moment of the actual HTTP call.
 */
export const flutchFetch: typeof fetch = (input, init) => {
  const ctx = als.getStore();
  const tok = internalToken();
  if (!ctx && !tok) {
    return fetch(input, init);
  }

  const headers = new Headers(init?.headers);
  if (ctx) {
    for (const key of Object.keys(HEADER_MAP) as (keyof FlutchContext)[]) {
      const value = ctx[key];
      if (value) {
        headers.set(HEADER_MAP[key], String(value));
      }
    }
  }
  if (tok) {
    headers.set(INTERNAL_TOKEN_HEADER, tok);
  }

  return fetch(input, { ...init, headers });
};

/**
 * Returns the X-Flutch-* headers for the current ALS context plus the
 * internal-token header when configured. Used by SDK integrations whose
 * underlying HTTP client doesn't accept a custom `fetch` (Cohere
 * `fetcher` arg, Mistral `beforeRequestHooks`, ...).
 *
 * Returns an empty object if no FlutchContext is installed and we are
 * not in internal mode.
 */
export function flutchHeaders(): Record<string, string> {
  const ctx = als.getStore();
  const tok = internalToken();
  const out: Record<string, string> = {};
  if (ctx) {
    for (const key of Object.keys(HEADER_MAP) as (keyof FlutchContext)[]) {
      const value = ctx[key];
      if (value) {
        out[HEADER_MAP[key]] = String(value);
      }
    }
  }
  if (tok) {
    out[INTERNAL_TOKEN_HEADER] = tok;
  }
  return out;
}

/**
 * beforeRequestHook for `@langchain/mistralai` / `@mistralai/mistralai`.
 * Mutates the outgoing Request to add X-Flutch-* headers from the current
 * ALS context (and X-Flutch-Internal-Token in SaaS mode).
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
 * (and the internal-token header in SaaS mode) from the current ALS
 * context into `args.headers`. Pass the result to
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
