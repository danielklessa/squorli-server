import type { FastifyRequest } from "fastify";

/**
 * Secrets that may ride in a query string and must not reach the request log (security review, 25 September 2026): the
 * status API's `key`, the signature `s` of an attachment link, the directory proof's `sig`. Their values become "***".
 */
const SECRET_PARAMS = new Set(["key", "s", "sig", "token"]);

export function redactUrl(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return url;
  const parts = url.slice(q + 1).split("&").map((part) => {
    const eq = part.indexOf("=");
    const name = eq < 0 ? part : part.slice(0, eq);
    let decoded = name;
    try { decoded = decodeURIComponent(name); } catch { /* keep as is */ }
    return eq >= 0 && SECRET_PARAMS.has(decoded.toLowerCase()) ? `${name}=***` : part;
  });
  return `${url.slice(0, q)}?${parts.join("&")}`;
}

/** Fastify's request serializer with the query redacted (the fields of its default one). */
export function requestSerializer(req: FastifyRequest) {
  return { method: req.method, url: redactUrl(req.url), host: req.host, remoteAddress: req.ip, ...(req.socket?.remotePort === undefined ? {} : { remotePort: req.socket.remotePort }) };
}
