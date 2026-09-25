/** The host (with a port other than the default) of a server's origin, as its PUBLIC_DOMAIN must name it (store.ts signDomainOf). */
export function connectedHost(base: string): string {
  try { return new URL(base).host.toLowerCase(); } catch { return ""; }
}
