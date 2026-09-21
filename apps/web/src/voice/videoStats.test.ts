import { describe, expect, it } from "vitest";
import { deriveVideoStats, diagnose, fmtBitrate, readInboundVideo, type InboundVideoSample } from "./videoStats";

/** A raw report the way Chromium fills it for one received H.265 track, as a Map (it has forEach and get like RTCStatsReport). */
function report(overrides: Record<string, unknown> = {}, extra: Record<string, Record<string, unknown>> = {}) {
  return new Map<string, Record<string, unknown>>(Object.entries({
    IT01: { type: "inbound-rtp", kind: "video", codecId: "CIT01", transportId: "T01", decoderImplementation: "ExternalDecoder", powerEfficientDecoder: true, frameWidth: 1920, frameHeight: 1080,
      framesReceived: 300, framesDecoded: 298, framesDropped: 2, keyFramesDecoded: 1, freezeCount: 0, totalFreezesDuration: 0, totalDecodeTime: 0.9, totalInterFrameDelay: 10, totalSquaredInterFrameDelay: 0.34,
      jitterBufferDelay: 15, jitterBufferEmittedCount: 298, jitter: 0.004, packetsReceived: 5000, packetsLost: 0, bytesReceived: 6_000_000, nackCount: 0, pliCount: 0, ...overrides },
    CIT01: { type: "codec", mimeType: "video/H265" },
    T01: { type: "transport", selectedCandidatePairId: "CP01" },
    CP01: { type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: 0.021 },
    ...extra,
  }));
}

describe("readInboundVideo", () => {
  it("takes the inbound video, its codec, decoder and the transport's round trip out of the raw report", () => {
    const s = readInboundVideo(report(), 1000);
    expect(s).toMatchObject({ at: 1000, codec: "H265", decoder: "ExternalDecoder", hardware: true, width: 1920, height: 1080, framesReceived: 300, framesDecoded: 298, bytesReceived: 6_000_000, roundTripTime: 0.021 });
  });
  it("returns null without an inbound video (the track is not received)", () => {
    expect(readInboundVideo(new Map([["A", { type: "inbound-rtp", kind: "audio" }]]), 1)).toBeNull();
  });
  it("finds the nominated pair without a transport report, and leaves out what the browser does not say", () => {
    const r = report({ transportId: undefined, powerEfficientDecoder: undefined, decoderImplementation: undefined, codecId: undefined }, { CP02: { type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: 0.05 } });
    r.delete("T01"); r.delete("CP01");
    expect(readInboundVideo(r, 1)).toMatchObject({ codec: null, decoder: null, hardware: null, roundTripTime: 0.05 });
  });
});

const sample = (at: number, o: Partial<InboundVideoSample> = {}): InboundVideoSample => ({
  at, codec: "H265", decoder: "ExternalDecoder", hardware: true, width: 1920, height: 1080,
  framesReceived: 0, framesDecoded: 0, framesDropped: 0, keyFramesDecoded: 0, freezeCount: 0, totalFreezesDuration: 0, totalDecodeTime: 0, totalInterFrameDelay: 0, totalSquaredInterFrameDelay: 0,
  jitterBufferDelay: 0, jitterBufferEmittedCount: 0, jitter: 0, packetsReceived: 0, packetsLost: 0, bytesReceived: 0, nackCount: 0, pliCount: 0, roundTripTime: 0.02, ...o,
});

describe("deriveVideoStats", () => {
  it("shows only the standing values before the second sample", () => {
    const v = deriveVideoStats(null, sample(0));
    expect(v).toMatchObject({ codec: "H265", width: 1920, seconds: 0, kbps: 0, decodeMs: null, jitterBufferMs: null, lossPercent: null, rttMs: 20, diagnosis: "starting" });
  });
  it("turns two samples into the interval's rates", () => {
    // 2 s: 60 frames at 30 fps, evenly 33.3 ms apart, 1.5 MB, every 10th packet lost, 4 ms decoding, 40 ms in the buffer.
    const gap = 1 / 30;
    const prev = sample(1000);
    const cur = sample(3000, { framesReceived: 60, framesDecoded: 60, framesDropped: 0, keyFramesDecoded: 1, totalDecodeTime: 0.24, totalInterFrameDelay: 60 * gap, totalSquaredInterFrameDelay: 60 * gap * gap, jitterBufferDelay: 2.4, jitterBufferEmittedCount: 60, packetsReceived: 900, packetsLost: 100, bytesReceived: 1_500_000, nackCount: 3 });
    const v = deriveVideoStats(prev, cur);
    expect(v).toMatchObject({ seconds: 2, kbps: 6000, fpsReceived: 30, fpsDecoded: 30, keyFrames: 1, packetsLost: 100, nacks: 3, lossPercent: 10, decodeMs: 4, jitterBufferMs: 40, interFrameJitterMs: 0, diagnosis: "network" });
  });
  it("measures the spacing's spread: frames 20 and 46 ms apart instead of 33 give a spread of 13 ms", () => {
    const gaps = [0.020, 0.046, 0.020, 0.046];
    const cur = sample(2000, { framesReceived: 4, framesDecoded: 4, totalInterFrameDelay: gaps.reduce((a, b) => a + b, 0), totalSquaredInterFrameDelay: gaps.reduce((a, b) => a + b * b, 0), packetsReceived: 10 });
    expect(deriveVideoStats(sample(1000), cur).interFrameJitterMs).toBe(13);
  });
  it("starts over when the counters went backwards (a new track under the same tile)", () => {
    const v = deriveVideoStats(sample(1000, { framesReceived: 500, bytesReceived: 9e6 }), sample(2000, { framesReceived: 20, bytesReceived: 1e5 }));
    expect(v.diagnosis).toBe("starting");
    expect(v.kbps).toBe(0);
  });
});

describe("diagnose", () => {
  const clean = { codec: "H265", decoder: null, hardware: true, width: 1920, height: 1080, seconds: 1, kbps: 5000, fpsReceived: 30, fpsDecoded: 30, framesDropped: 0, freezes: 0, freezeMs: 0, keyFrames: 0, packetsLost: 0, nacks: 0, plis: 0, lossPercent: 0, decodeMs: 4, jitterBufferMs: 40, interFrameJitterMs: 3, rttMs: 20 };
  it("finds nothing unusual in a clean interval", () => { expect(diagnose(clean)).toBe("ok"); });
  it("blames the network for loss, a full jitter buffer, or a freeze with retransmits", () => {
    expect(diagnose({ ...clean, lossPercent: 1 })).toBe("network");
    expect(diagnose({ ...clean, jitterBufferMs: 200 })).toBe("network");
    expect(diagnose({ ...clean, freezes: 1, nacks: 2 })).toBe("network");
    expect(diagnose({ ...clean, freezes: 1 })).toBe("ok");
  });
  it("blames the decoder for slow decoding or many dropped frames", () => {
    expect(diagnose({ ...clean, decodeMs: 26 })).toBe("decoder");
    expect(diagnose({ ...clean, framesDropped: 4 })).toBe("decoder");
    expect(diagnose({ ...clean, framesDropped: 3 })).toBe("ok");
  });
  it("blames the sender for few frames of a moving-pictures share only, never a VP8 desktop that stands still", () => {
    expect(diagnose({ ...clean, fpsReceived: 12, fpsDecoded: 12 })).toBe("sender");
    expect(diagnose({ ...clean, codec: "H264", fpsReceived: 12, fpsDecoded: 12 })).toBe("sender");
    expect(diagnose({ ...clean, codec: "VP8", fpsReceived: 2, fpsDecoded: 2 })).toBe("ok");
  });
  it("puts the network before the decoder and the decoder before the sender", () => {
    expect(diagnose({ ...clean, lossPercent: 5, decodeMs: 40, fpsReceived: 5 })).toBe("network");
    expect(diagnose({ ...clean, decodeMs: 40, fpsReceived: 5 })).toBe("decoder");
  });
});

describe("fmtBitrate", () => {
  it("prints Mbit/s from 1000 kbit/s", () => {
    expect(fmtBitrate(640)).toBe("640 kbit/s");
    expect(fmtBitrate(5870)).toBe("5.87 Mbit/s");
  });
});
