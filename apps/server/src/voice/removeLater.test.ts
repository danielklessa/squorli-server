import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LivekitAdmin } from "../livekit/admin";
import type { VoicePresence } from "./presence";
import { REMOVE_GRACE_MS, removeLater } from "./removeLater";

describe("removeLater", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const setup = (seat: string | undefined) => {
    const removed: string[] = [];
    const lk = { removeParticipant: async (room: string, id: string) => { removed.push(`${room}:${id}`); } } as unknown as LivekitAdmin;
    const presence = { channelOfUser: () => seat } as unknown as VoicePresence;
    return { removed, lk, presence };
  };

  it("gives the member's client a moment, then removes them from the room", () => {
    const { removed, lk, presence } = setup(undefined);
    removeLater(lk, presence, "c", "u", () => {});
    expect(removed).toEqual([]);
    vi.advanceTimersByTime(REMOVE_GRACE_MS);
    expect(removed).toEqual(["c:u"]);
  });

  it("leaves a member alone who sits in that channel again (moved back by a moderator)", () => {
    const { removed, lk, presence } = setup("c");
    removeLater(lk, presence, "c", "u", () => {});
    vi.advanceTimersByTime(REMOVE_GRACE_MS);
    expect(removed).toEqual([]);
  });
});
