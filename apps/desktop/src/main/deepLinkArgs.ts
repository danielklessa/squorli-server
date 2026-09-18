import { DEEP_LINK_SCHEME, parseDeepLink } from "@squorli/web/platform/deepLink";

/**
 * The first command line argument that is a valid `squorli://` link; everything else is ignored. Pure (tested) and free of
 * Electron imports, so the tests run where Electron's binary is not installed (CI).
 */
export function findDeepLink(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (!arg.toLowerCase().startsWith(`${DEEP_LINK_SCHEME}:`)) continue;
    if (parseDeepLink(arg)) return arg.trim();
  }
  return null;
}
