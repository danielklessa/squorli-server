import { protocol } from "electron";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { APP_HOST, APP_SCHEME, CONTENT_SECURITY_POLICY, contentTypeOf, resolveAppFile } from "./appFiles";

/** Before `app.ready`: `app://` behaves like https (secure context, fetch, storage, streams). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
}

/** After `app.ready`: serve the web client's build (`root`) from `app://squorli`. */
export function serveApp(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST || (request.method !== "GET" && request.method !== "HEAD")) return new Response(null, { status: 404 });
    const file = resolveAppFile(root, url.pathname);
    if (!file) return new Response(null, { status: 404 });
    try {
      const body = await readFile(file);
      const headers: Record<string, string> = { "content-type": contentTypeOf(file), "x-content-type-options": "nosniff", "cache-control": "no-cache" };
      if (extname(file) === ".html") headers["content-security-policy"] = CONTENT_SECURITY_POLICY;
      return new Response(request.method === "HEAD" ? null : body, { headers });
    } catch { return new Response(null, { status: 404 }); }
  });
}
