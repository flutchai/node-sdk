const SECRET_PARAM = /(pass|pwd|secret|token|key|credential)/i;

/**
 * Connection string safe for logs: credentials are replaced with `***`,
 * secret-looking query parameters are masked, hosts and database stay
 * (they are what you need to debug a connection).
 *
 * `mongodb://user:pass@h1,h2/db?authSource=admin&password=x`
 *   → `mongodb://***@h1,h2/db?authSource=admin&password=***`
 *
 * Anything that doesn't look like `scheme://...` is fully redacted: a
 * malformed value may still carry a password.
 */
export function redactConnectionString(
  value: string | undefined | null
): string {
  if (!value) return "";
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(value.trim());
  if (!match) return "[redacted]";
  const [, scheme, authority, rest] = match;

  const at = authority.lastIndexOf("@");
  const hosts = at >= 0 ? `***@${authority.slice(at + 1)}` : authority;

  const queryStart = rest.indexOf("?");
  if (queryStart < 0) return `${scheme}${hosts}${rest}`;
  const path = rest.slice(0, queryStart);
  const [query, fragment] = rest.slice(queryStart + 1).split("#", 2);
  const params = query
    .split("&")
    .map(pair => {
      const eq = pair.indexOf("=");
      if (eq < 0) return pair;
      const key = pair.slice(0, eq);
      return SECRET_PARAM.test(key) ? `${key}=***` : pair;
    })
    .join("&");
  return `${scheme}${hosts}${path}?${params}${fragment !== undefined ? `#${fragment}` : ""}`;
}
