import { describe, expect, it } from "vitest";
import { classifyMedia, isPrivateAddress, selectedPath } from "./doctorMedia";

const report = (over: Partial<Record<string, Record<string, unknown>>> = {}) => [
  { type: "transport", id: "T1", selectedCandidatePairId: "P1" },
  { type: "candidate-pair", id: "P1", localCandidateId: "L1", remoteCandidateId: "R1", state: "succeeded", nominated: true },
  { type: "candidate-pair", id: "P2", localCandidateId: "L1", remoteCandidateId: "R2", state: "failed" },
  { type: "local-candidate", id: "L1", candidateType: "srflx", protocol: "udp", address: "203.0.113.9", port: 50000, ...over.local },
  { type: "remote-candidate", id: "R1", candidateType: "host", protocol: "udp", address: "198.51.100.7", port: 7882, ...over.remote },
  { type: "remote-candidate", id: "R2", candidateType: "host", protocol: "tcp", address: "198.51.100.7", port: 7881 },
];

describe("selectedPath", () => {
  it("reads the transport's selected pair", () => {
    expect(selectedPath(report())).toEqual({ protocol: "udp", address: "198.51.100.7", port: 7882, relay: false });
  });
  it("falls back to the nominated succeeded pair without a transport entry (Firefox)", () => {
    const stats = report().filter((s) => s.type !== "transport");
    expect(selectedPath(stats)?.address).toBe("198.51.100.7");
  });
  it("takes `ip` where a browser has no `address`, and marks a relay", () => {
    const stats = report({ remote: { address: undefined, ip: "198.51.100.7" }, local: { candidateType: "relay" } });
    expect(selectedPath(stats)).toEqual({ protocol: "udp", address: "198.51.100.7", port: 7882, relay: true });
  });
  it("is null without a selected pair", () => {
    expect(selectedPath([{ type: "candidate-pair", id: "P", state: "in-progress" }])).toBeNull();
  });
});

describe("classifyMedia", () => {
  const path = (over: Partial<ReturnType<typeof selectedPath>> = {}) => ({ protocol: "udp", address: "198.51.100.7", port: 7882, relay: false, ...over });
  it("udp to a public address is fine", () => expect(classifyMedia(path(), 900).kind).toBe("ok"));
  it("tcp means udp did not get through", () => expect(classifyMedia(path({ protocol: "tcp", port: 7881 }), 900).kind).toBe("tcp-only"));
  it("a private announced address points at LIVEKIT_NODE_IP", () => expect(classifyMedia(path({ address: "172.18.0.4" }), 900).kind).toBe("private-address"));
  it("a relay is named before anything else", () => expect(classifyMedia(path({ relay: true, address: "10.0.0.1" }), 900).kind).toBe("relay"));
  it("no path is still a connection", () => expect(classifyMedia(null, 900).kind).toBe("connected-unknown"));
});

describe("isPrivateAddress", () => {
  it("knows the private ranges", () => {
    for (const a of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "::1", "fe80::1", "fd12::1", "::ffff:192.168.0.1"]) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["203.0.113.9", "172.32.0.1", "8.8.8.8", "2001:db8::1", "100.128.0.1"]) expect(isPrivateAddress(a), a).toBe(false);
  });
});
