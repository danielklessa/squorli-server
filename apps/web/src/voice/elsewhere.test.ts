import { describe, expect, it } from "vitest";
import { voiceElsewhere } from "./elsewhere";

const me = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("voiceElsewhere", () => {
  it("names the channel that lists the account, else null", () => {
    const voice = { lobby: [{ userId: other, displayName: "B" }], games: [{ userId: me, displayName: "A" }] };
    expect(voiceElsewhere(voice, me)).toBe("games");
    expect(voiceElsewhere({ lobby: [{ userId: other, displayName: "B" }] }, me)).toBeNull();
    expect(voiceElsewhere({}, me)).toBeNull();
    expect(voiceElsewhere(voice, null)).toBeNull();
  });
});
