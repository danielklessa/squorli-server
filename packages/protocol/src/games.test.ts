import { describe, expect, it } from "vitest";
import { AccountSettings, ClientEvent, DirectoryClientEvent, DirectoryServerEvent, Friend, GamePresence, Member } from "./index";

const KEY = "a".repeat(64);
const UUID = "6f1c2a4e-1b2c-4d3e-8f90-000000000000";

describe("game display", () => {
  it("takes a launcher's id with a name, or a name alone", () => {
    expect(GamePresence.parse({ id: "steam:730", name: "  Counter-Strike 2 " })).toEqual({ id: "steam:730", name: "Counter-Strike 2" });
    expect(GamePresence.parse({ name: "Altes Spiel" })).toEqual({ name: "Altes Spiel" });
  });

  it("never takes what is not a launcher's id (a path of an added program), a name with line breaks, or an endless one", () => {
    for (const bad of [{ id: "custom:d:\\spiele\\alt.exe", name: "A" }, { id: "epic:Sugar", name: "A" }, { name: "" }, { name: "  " }, { name: "A\nB" }, { name: "A\u0000B" }, { name: "x".repeat(65) }, { id: "steam:730" }, "steam:730"]) {
      expect(GamePresence.safeParse(bad).success).toBe(false);
    }
  });

  it("rides on the activity report of both sockets: a game, none, or nothing said", () => {
    for (const Event of [ClientEvent, DirectoryClientEvent]) {
      const playing = Event.parse({ type: "activity", idle: false, game: { id: "xbox:9NHFVWX1V7QJ", name: "Deep Rock Galactic" } });
      expect(playing.type === "activity" && playing.game).toEqual({ id: "xbox:9NHFVWX1V7QJ", name: "Deep Rock Galactic" });
      const none = Event.parse({ type: "activity", idle: true, game: null });
      expect(none.type === "activity" && none.game).toBeNull();
      const silent = Event.parse({ type: "activity", idle: true });
      expect(silent.type === "activity" && silent.game).toBeUndefined();
      expect(Event.safeParse({ type: "activity", idle: false, game: { id: "custom:x", name: "A" } }).success).toBe(false);
    }
  });

  it("stays readable for data from before it: members, friends and presence default to no game", () => {
    expect(Member.parse({ userId: UUID, displayName: "A", publicKey: KEY, roleIds: [], joinedAt: "2026-09-17T00:00:00.000Z", online: true, streamBlocked: false, handle: null, isOwner: false }).game).toBeNull();
    expect(Friend.parse({ handle: "anna", publicKey: KEY, displayName: null, state: "accepted", since: "2026-09-17T00:00:00.000Z", online: true }).game).toBeNull();
    const presence = DirectoryServerEvent.parse({ type: "friends.presence", publicKey: KEY, online: true, game: { name: "Balatro" } });
    expect(presence.type === "friends.presence" && presence.game).toEqual({ name: "Balatro" });
  });

  it("keeps the two switches in the account, and an account from before them says nothing", () => {
    expect(AccountSettings.parse({}).games).toBeUndefined();
    expect(AccountSettings.parse({ games: {} }).games).toEqual({ enabled: false, servers: true });
    expect(AccountSettings.parse({ games: { enabled: true, servers: false } }).games).toEqual({ enabled: true, servers: false });
  });
});
