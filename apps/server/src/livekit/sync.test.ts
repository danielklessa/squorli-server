import { describe, expect, it } from "vitest";
import { VoicePresence } from "../voice/presence";
import { syncStreamGrants } from "./sync";

function fakeLk() {
  const calls: string[] = [];
  return {
    calls,
    setCanStream: async (room: string, identity: string, allowed: boolean) => { calls.push(`grant ${room} ${identity} ${allowed}`); },
    stopStreams: async (room: string, identity: string) => { calls.push(`stop ${room} ${identity}`); },
  };
}

describe("syncStreamGrants", () => {
  it("grants camera and screen to a member who got the permission while sitting in voice", async () => {
    const lk = fakeLk();
    await syncStreamGrants([{ userId: "u1", channelId: "c1" }], null, async () => true, lk);
    expect(lk.calls).toEqual(["grant c1 u1 true"]);
  });
  it("takes them away and ends running streams when the permission is gone", async () => {
    const lk = fakeLk();
    await syncStreamGrants([{ userId: "u1", channelId: "c1" }], null, async () => false, lk);
    expect(lk.calls).toEqual(["grant c1 u1 false", "stop c1 u1"]);
  });
  it("leaves members in the AFK channel silenced", async () => {
    const lk = fakeLk();
    await syncStreamGrants([{ userId: "u1", channelId: "afk" }, { userId: "u2", channelId: "c1" }], "afk", async () => true, lk);
    expect(lk.calls).toEqual(["grant c1 u2 true"]);
  });
});

describe("VoicePresence.seated", () => {
  it("lists every user once with the channel of the first connection", () => {
    const p = new VoicePresence<string>();
    const member = (userId: string) => ({ userId, displayName: userId, micMuted: false, deafened: false, cameraOn: false, screenOn: false });
    p.join("a1", "c1", member("u1"));
    p.join("a2", "c2", member("u1"));
    p.join("b1", "c2", member("u2"));
    expect(p.seated()).toEqual([{ userId: "u1", channelId: "c1" }, { userId: "u2", channelId: "c2" }]);
  });
});
