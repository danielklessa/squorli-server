/**
 * A received video track's statistics for the viewer (22 September 2026, user's wish: "als Zuschauer Statistiken zu einer
 * Bildschirmübertragung ansehen"), pure and tested. `readInboundVideo` takes one sample out of a receiver's raw `getStats()`
 * report: LiveKit's `getReceiverStats()` leaves out what says where a lag comes from (freezes, the jitter buffer, decode time,
 * the round trip, whether the decoder runs in hardware). `deriveVideoStats` turns the sample before and the sample now into
 * rates for the interval between them, and `diagnose` names the side the numbers point at.
 */

/** Cumulative counters of a received video track (the browser's inbound-rtp report, its codec and transport). Times in seconds. */
export type InboundVideoSample = {
  /** `performance.now()` of the reading, ms. */
  at: number;
  /** "H265", "VP8", ...; null = not reported yet. */
  codec: string | null;
  /** The browser's decoder for it, e.g. "ExternalDecoder" (hardware) or "libvpx"; null = not reported. */
  decoder: string | null;
  /** The decoder runs in hardware (Chromium's `powerEfficientDecoder`); null = the browser does not say. */
  hardware: boolean | null;
  width: number;
  height: number;
  framesReceived: number;
  framesDecoded: number;
  framesDropped: number;
  keyFramesDecoded: number;
  freezeCount: number;
  totalFreezesDuration: number;
  totalDecodeTime: number;
  totalInterFrameDelay: number;
  totalSquaredInterFrameDelay: number;
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
  jitter: number;
  packetsReceived: number;
  packetsLost: number;
  bytesReceived: number;
  nackCount: number;
  pliCount: number;
  /** The transport's current round trip; null = not reported. */
  roundTripTime: number | null;
};

/** What a `RTCStatsReport` offers (a `Map` does too, for the tests). */
type StatsLike = { forEach(cb: (value: Record<string, unknown>) => void): void; get(id: string): Record<string, unknown> | undefined };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The receiver's video sample from its raw report; null = no inbound video in it (the track is not received). */
export function readInboundVideo(report: StatsLike, at: number): InboundVideoSample | null {
  let inbound: Record<string, unknown> | null = null;
  let anyPair: Record<string, unknown> | null = null;
  report.forEach((s) => {
    if (!inbound && s.type === "inbound-rtp" && s.kind === "video") inbound = s;
    // The transport names its selected pair; without a transport report the nominated, succeeded pair is the one in use.
    if (s.type === "candidate-pair" && s.state === "succeeded" && (s.nominated === true || !anyPair)) anyPair = s;
  });
  if (!inbound) return null;
  const s: Record<string, unknown> = inbound;
  const codec = typeof s.codecId === "string" ? report.get(s.codecId) : undefined;
  const transport = typeof s.transportId === "string" ? report.get(s.transportId) : undefined;
  const selected = typeof transport?.selectedCandidatePairId === "string" ? report.get(transport.selectedCandidatePairId) : undefined;
  const pair = selected ?? anyPair;
  const rtt = pair?.currentRoundTripTime;
  return {
    at,
    codec: str(codec?.mimeType)?.replace(/^video\//i, "") ?? null,
    decoder: str(s.decoderImplementation),
    hardware: typeof s.powerEfficientDecoder === "boolean" ? s.powerEfficientDecoder : null,
    width: num(s.frameWidth), height: num(s.frameHeight),
    framesReceived: num(s.framesReceived), framesDecoded: num(s.framesDecoded), framesDropped: num(s.framesDropped), keyFramesDecoded: num(s.keyFramesDecoded),
    freezeCount: num(s.freezeCount), totalFreezesDuration: num(s.totalFreezesDuration),
    totalDecodeTime: num(s.totalDecodeTime), totalInterFrameDelay: num(s.totalInterFrameDelay), totalSquaredInterFrameDelay: num(s.totalSquaredInterFrameDelay),
    jitterBufferDelay: num(s.jitterBufferDelay), jitterBufferEmittedCount: num(s.jitterBufferEmittedCount), jitter: num(s.jitter),
    packetsReceived: num(s.packetsReceived), packetsLost: num(s.packetsLost), bytesReceived: num(s.bytesReceived),
    nackCount: num(s.nackCount), pliCount: num(s.pliCount),
    roundTripTime: typeof rtt === "number" && Number.isFinite(rtt) ? rtt : null,
  };
}

/** Which side the numbers point at; "starting" = no interval measured yet. */
export type Diagnosis = "starting" | "ok" | "network" | "decoder" | "sender";

/** The interval's rates, as the overlay shows them. `null` = the browser gave no basis for that number in this interval. */
export type VideoStatsView = {
  codec: string | null;
  decoder: string | null;
  hardware: boolean | null;
  width: number;
  height: number;
  /** Length of the measured interval, s; 0 before the second sample. */
  seconds: number;
  kbps: number;
  fpsReceived: number;
  fpsDecoded: number;
  /** In this interval. */
  framesDropped: number;
  freezes: number;
  freezeMs: number;
  keyFrames: number;
  packetsLost: number;
  nacks: number;
  plis: number;
  /** Lost packets as a share of all packets of the interval, in percent. */
  lossPercent: number | null;
  /** Average per decoded frame of the interval. */
  decodeMs: number | null;
  /** Average time a frame waited in the jitter buffer in the interval. */
  jitterBufferMs: number | null;
  /** Standard deviation of the spacing between decoded frames, ms; at 30 fps a smooth picture stays well under 10. */
  interFrameJitterMs: number | null;
  rttMs: number | null;
  diagnosis: Diagnosis;
};

const EMPTY_RATES = { seconds: 0, kbps: 0, fpsReceived: 0, fpsDecoded: 0, framesDropped: 0, freezes: 0, freezeMs: 0, keyFrames: 0, packetsLost: 0, nacks: 0, plis: 0, lossPercent: null, decodeMs: null, jitterBufferMs: null, interFrameJitterMs: null } as const;

/** The view for the interval from `prev` to `cur`; with no `prev` (or a `cur` from a new track: counters went backwards) only the standing values. */
export function deriveVideoStats(prev: InboundVideoSample | null, cur: InboundVideoSample): VideoStatsView {
  const standing = { codec: cur.codec, decoder: cur.decoder, hardware: cur.hardware, width: cur.width, height: cur.height, rttMs: cur.roundTripTime === null ? null : Math.round(cur.roundTripTime * 1000) };
  const seconds = prev ? (cur.at - prev.at) / 1000 : 0;
  if (!prev || seconds <= 0 || cur.framesReceived < prev.framesReceived || cur.bytesReceived < prev.bytesReceived) return { ...standing, ...EMPTY_RATES, diagnosis: "starting" };
  const d = (key: keyof InboundVideoSample) => Math.max(0, num(cur[key]) - num(prev[key]));
  const decoded = d("framesDecoded");
  const received = d("packetsReceived");
  const lost = d("packetsLost");
  const emitted = d("jitterBufferEmittedCount");
  const meanGap = decoded > 0 ? d("totalInterFrameDelay") / decoded : 0;
  const variance = decoded > 0 ? d("totalSquaredInterFrameDelay") / decoded - meanGap * meanGap : 0;
  const view: Omit<VideoStatsView, "diagnosis"> = {
    ...standing,
    seconds,
    kbps: Math.round((d("bytesReceived") * 8) / seconds / 1000),
    fpsReceived: Math.round(d("framesReceived") / seconds),
    fpsDecoded: Math.round(decoded / seconds),
    framesDropped: d("framesDropped"),
    freezes: d("freezeCount"),
    freezeMs: Math.round(d("totalFreezesDuration") * 1000),
    keyFrames: d("keyFramesDecoded"),
    packetsLost: lost,
    nacks: d("nackCount"),
    plis: d("pliCount"),
    lossPercent: received + lost > 0 ? Math.round((lost / (received + lost)) * 1000) / 10 : null,
    decodeMs: decoded > 0 ? Math.round((d("totalDecodeTime") / decoded) * 10_000) / 10 : null,
    jitterBufferMs: emitted > 0 ? Math.round((d("jitterBufferDelay") / emitted) * 1000) : null,
    interFrameJitterMs: decoded > 1 ? Math.round(Math.sqrt(Math.max(0, variance)) * 1000) : null,
  };
  return { ...view, diagnosis: diagnose(view) };
}

/**
 * Where a lag comes from, in this order (my choice, 22 September 2026, not measured against real cases yet):
 * - network: a percent of the packets lost, or frames waited 200 ms and more in the jitter buffer, or a freeze with retransmits;
 * - decoder: decoding takes longer than a frame at 30 fps has (over 25 ms), or a tenth of the decoded frames were dropped;
 * - sender: a share of moving pictures (H.264, H.265: the desktop app sends those only for a game) arrives with fewer than
 *   20 frames a second while the network is clean; a VP8 share of a still desktop legitimately sends few frames, so it is
 *   never blamed on the sender.
 */
export function diagnose(v: Omit<VideoStatsView, "diagnosis">): Diagnosis {
  if (v.seconds <= 0) return "starting";
  if ((v.lossPercent ?? 0) >= 1 || (v.jitterBufferMs ?? 0) >= 200 || (v.freezes > 0 && v.nacks > 0)) return "network";
  if ((v.decodeMs ?? 0) > 25 || (v.fpsDecoded > 0 && v.framesDropped > v.fpsDecoded * v.seconds * 0.1)) return "decoder";
  const moving = /^h26[45]$/i.test(v.codec ?? "");
  if (moving && v.fpsReceived < 20) return "sender";
  return "ok";
}

/** "5.87 Mbit/s" or "640 kbit/s". */
export const fmtBitrate = (kbps: number): string => (kbps >= 1000 ? `${(kbps / 1000).toFixed(2)} Mbit/s` : `${kbps} kbit/s`);
