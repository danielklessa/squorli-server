import { ConnectionError, ConnectionErrorReason, Room } from "livekit-client";
import type { ServerApi } from "./api";

/**
 * The browser's part of the setup check (docs/features/doctor.md): a real media connection to LiveKit from where the
 * administrator sits. It is the only check that tells whether UDP reaches the server (the server cannot probe its own UDP
 * port, and nothing answers a bare packet), whether the TCP fallback carries it instead, and which address LiveKit announces
 * (a private one means LIVEKIT_NODE_IP is missing). The room is `doctor-<userId>`, nothing is published.
 */

export type MediaPath = { protocol: string; address: string; port: number | null; relay: boolean };
export type MediaCheckResult =
  | { kind: "ok" | "tcp-only" | "relay" | "private-address"; path: MediaPath; ms: number }
  | { kind: "connected-unknown"; ms: number }
  | { kind: "media-failed" | "signal-failed" | "not-allowed"; error: string; ms: number };

/** RFC 1918, loopback, link-local and unique-local addresses: an address only the server's own network can reach. */
export function isPrivateAddress(address: string): boolean {
  const a = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a)) return true;
  if (a === "::1" || a.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(a)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  return mapped ? isPrivateAddress(mapped[1]!) : false;
}

/** The selected ICE candidate pair of a stats report: how the media really flows (pure, tested). */
export function selectedPath(stats: Iterable<Record<string, unknown>>): MediaPath | null {
  let selectedId: string | null = null;
  const pairs = new Map<string, Record<string, unknown>>();
  const candidates = new Map<string, Record<string, unknown>>();
  for (const v of stats) {
    switch (v.type) {
      case "transport": if (typeof v.selectedCandidatePairId === "string" && v.selectedCandidatePairId) selectedId = v.selectedCandidatePairId; break;
      case "candidate-pair": pairs.set(String(v.id), v); break;
      case "remote-candidate": case "local-candidate": candidates.set(String(v.id), v); break;
    }
  }
  const pair = (selectedId && pairs.get(selectedId)) || [...pairs.values()].find((p) => p.selected === true || (p.nominated === true && p.state === "succeeded")) || null;
  if (!pair) return null;
  const remote = candidates.get(String(pair.remoteCandidateId));
  const local = candidates.get(String(pair.localCandidateId));
  if (!remote) return null;
  const address = String(remote.address ?? remote.ip ?? "");
  if (!address) return null;
  const port = typeof remote.port === "number" ? remote.port : null;
  const protocol = String(remote.protocol ?? local?.protocol ?? "").toLowerCase();
  const relay = local?.candidateType === "relay" || remote.candidateType === "relay";
  return { protocol, address, port, relay };
}

/** What the path means for the operator (pure, tested). */
export function classifyMedia(path: MediaPath | null, ms: number): MediaCheckResult {
  if (!path) return { kind: "connected-unknown", ms };
  if (path.relay) return { kind: "relay", path, ms };
  if (isPrivateAddress(path.address)) return { kind: "private-address", path, ms };
  if (path.protocol === "tcp") return { kind: "tcp-only", path, ms };
  return { kind: "ok", path, ms };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Connect, read the selected path, leave. Never throws: every failure is a result. */
export async function runMediaCheck(api: ServerApi): Promise<MediaCheckResult> {
  const started = Date.now();
  const { url, token } = await api.doctorRtcToken();
  const room = new Room();
  try {
    await room.connect(url, token, { autoSubscribe: false, peerConnectionTimeout: 12_000 });
  } catch (err) {
    const ms = Date.now() - started;
    const error = err instanceof Error ? err.message : String(err);
    if (err instanceof ConnectionError) {
      if (err.reason === ConnectionErrorReason.Timeout) return { kind: "media-failed", error, ms };
      if (err.reason === ConnectionErrorReason.NotAllowed) return { kind: "not-allowed", error, ms };
      return { kind: "signal-failed", error, ms };
    }
    return { kind: "signal-failed", error, ms };
  }
  let path: MediaPath | null = null;
  try {
    const pc = room.engine.pcManager?.subscriber ?? room.engine.pcManager?.publisher;
    // The selected pair shows up a moment after the connection; a few short looks instead of one long wait.
    for (let i = 0; i < 15 && !path; i++) {
      const stats = await pc?.getStats();
      if (stats) path = selectedPath(stats.values() as Iterable<Record<string, unknown>>);
      if (!path) await sleep(200);
    }
  } catch { /* stats are best effort */ }
  const ms = Date.now() - started;
  await room.disconnect().catch(() => {});
  return classifyMedia(path, ms);
}
