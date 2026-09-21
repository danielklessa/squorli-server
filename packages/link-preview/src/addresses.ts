import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Which addresses a fetch on behalf of a user may reach. Whoever fetches an address somebody typed (a radio station, a link
 * in a message) must never be made to ask the machine itself or its private network.
 */
const internal = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 3]] as const) internal.addSubnet(net, bits, "ipv4");
// No rule for ::ffff:0:0/96: Node's BlockList compares IPv4 and IPv4-mapped IPv6 addresses with each other, so such a rule
// would block every IPv4 address, and the IPv4 rules above already cover the mapped spelling (pinned by the test).
for (const [net, bits] of [["::", 127], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) internal.addSubnet(net, bits, "ipv6");

export function isInternalAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  const a = mapped ? mapped[1]! : address;
  const family = isIP(a);
  if (family === 0) return true; // not an address at all
  return internal.check(a, family === 6 ? "ipv6" : "ipv4");
}

/** Every address of the host must be public; a name that does not resolve is simply unreachable. */
export async function checkHost(hostname: string): Promise<"public" | "internal" | "unknown"> {
  const host = hostname.replace(/^\[|\]$/g, "");
  try {
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (addresses.length === 0) return "unknown";
    return addresses.every((a) => !isInternalAddress(a.address)) ? "public" : "internal";
  } catch { return "unknown"; }
}

/**
 * DNS for a connection made with node's http(s).request: the address actually connected to must be public, which closes the
 * gap between `checkHost` and the connect (a name that answers differently the second time). An address typed as a number
 * is never looked up, so `checkHost` stays necessary.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, options, (err, address, family) => {
    const all = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (!err && all.some((a) => isInternalAddress(a))) return callback(Object.assign(new Error("internal address"), { code: "EACCES" }), address as never, family);
    callback(err, address as never, family);
  });
};
