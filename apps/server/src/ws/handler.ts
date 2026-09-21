import { ClientEvent, PROTOCOL_VERSION, Permission, displayNameOf, type GamePresence, type ServerEvent } from "@squorli/protocol";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { resolveSession } from "../auth/session";
import { can } from "../authz";
import type { Db } from "../db";
import { channels, users } from "../db/schema";
import type { Hub } from "../hub";
import { actorOf, loadChannels, loadState } from "../state";
import type { VoicePresence } from "../voice/presence";
import type { RadioMetadata } from "../radio/metadata";
import type { LivekitAdmin } from "../livekit/admin";
import { Liveness, PING_EVERY_MS } from "./liveness";

/** Game display: how often one connection may change what its member plays (each change is a broadcast to everybody). */
const GAME_CHANGE_MS = 5000;

/**
 * Real-time channel for everything except media: state after the handshake, presence, channel state, messages, typing.
 * State reconciliation by sequence number after a reconnect: the client reloads /api/state and the history (M2).
 */
export async function registerWs(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence<WebSocket>, radioMeta: RadioMetadata, lk: LivekitAdmin) {
  const unsubscribe = presence.onChange((channelId, members) => {
    hub.broadcast({ type: "voice.state", channelId, members });
  });
  app.addHook("onClose", async () => unsubscribe());

  // Connections whose other end vanished without a close would keep their voice presence and keep their user "present"
  // for the AFK detection for ever (liveness.ts): ping them, terminate the dead, count the silent ones as idle.
  const liveness = new Liveness<WebSocket>();
  const heartbeat = setInterval(() => {
    const { dead, stale } = liveness.sweep();
    for (const ws of dead) { app.log.info("ws terminated: nothing heard"); ws.terminate(); }
    for (const ws of stale) hub.setStale(ws, true);
    for (const ws of liveness.connections()) if (ws.readyState === ws.OPEN) ws.ping();
    // Entries taken over from LiveKit (below) are a guess: gone once the participant is.
    const restored = presence.restoredEntries();
    if (restored.length) void lk.roomsByIdentity().then((rooms) => { if (rooms) for (const e of restored) if (rooms.get(e.userId) !== e.channelId && presence.channelOf(e.conn) === e.channelId) presence.leave(e.conn); });
  }, PING_EVERY_MS);
  app.addHook("onClose", async () => clearInterval(heartbeat));

  app.get("/api/ws", { websocket: true }, (socket: WebSocket, req) => {
    let userId: string | null = null;
    const send = (e: ServerEvent) => hub.send(socket, e);
    const helloTimeout = setTimeout(() => socket.close(4001, "hello timeout"), 10_000);
    let lastTyping = 0;
    // Game display: every change goes to all members, so a connection's reports take effect at most every GAME_CHANGE_MS;
    // what arrives in between waits, and only the last one counts.
    let lastGameAt = 0;
    let gameTimer: NodeJS.Timeout | null = null;
    let waitingGame: GamePresence | null = null;
    const applyGame = (game: GamePresence | null) => { lastGameAt = Date.now(); hub.setGame(socket, game); };
    const reportGame = (game: GamePresence | null) => {
      const wait = lastGameAt + GAME_CHANGE_MS - Date.now();
      if (wait <= 0 && !gameTimer) return applyGame(game);
      waitingGame = game;
      gameTimer ??= setTimeout(() => { gameTimer = null; applyGame(waitingGame); }, Math.max(wait, 0));
    };

    socket.on("pong", () => { liveness.heard(socket, false); });
    socket.on("message", async (raw) => {
      if (liveness.heard(socket, true)) hub.setStale(socket, false);
      let json: unknown;
      try { json = JSON.parse(raw.toString()); } catch { return send({ type: "error", code: "bad_message", message: "invalid json" }); }
      const ev = ClientEvent.safeParse(json);
      if (!ev.success) return send({ type: "error", code: "bad_message", message: "unknown event" });

      if (ev.data.type === "hello") {
        if (ev.data.protocolVersion !== PROTOCOL_VERSION) {
          send({ type: "error", code: "protocol_version", message: `server speaks v${PROTOCOL_VERSION}` });
          return socket.close(4002, "protocol version");
        }
        const session = await resolveSession(db, ev.data.sessionToken);
        const actor = session ? await actorOf(db, session.userId) : null;
        if (!session || !actor) {
          send({ type: "error", code: "unauthorized", message: session ? "not a member" : "session invalid" });
          return socket.close(4003, "unauthorized");
        }
        userId = session.userId;
        clearTimeout(helloTimeout);
        hub.add(userId, socket, session.sessionId);
        liveness.add(socket);
        req.log.info({ userId }, "ws connected");
        send({ type: "welcome", userId, serverTime: new Date().toISOString(), protocolVersion: PROTOCOL_VERSION, state: await loadState(db, hub, userId) });
        for (const ch of await loadChannels(db)) {
          if (ch.kind === "voice") send({ type: "voice.state", channelId: ch.id, members: presence.members(ch.id) });
          const title = radioMeta.titleOf(ch.id);
          if (title) send({ type: "radio.meta", channelId: ch.id, title });
        }
        // Voice outlives this process and every reconnect (LiveKit), the presence here does not: a member who is still
        // talking comes back into their channel's list. Clients of today say it themselves right after the welcome
        // (then there is nothing to do here); older ones (desktop app up to 0.1.2) never do.
        const rooms = await lk.roomsByIdentity();
        const room = rooms?.get(userId);
        if (room && socket.readyState === socket.OPEN && !presence.channelOfUser(userId)) {
          const [channel] = await db.select({ id: channels.id, kind: channels.kind }).from(channels).where(eq(channels.id, room)).limit(1);
          const [user] = await db.select({ publicKey: users.publicKey, displayName: users.displayName, handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1);
          if (channel?.kind === "voice" && user && socket.readyState === socket.OPEN && !presence.channelOfUser(userId)) presence.join(socket, channel.id, { userId, displayName: displayNameOf(user) }, true);
        }
        return;
      }

      if (!userId) return socket.close(4003, "hello first");

      switch (ev.data.type) {
        case "ping":
          return send({ type: "pong", t: ev.data.t });
        case "voice.join": {
          const actor = await actorOf(db, userId);
          if (!actor || !can(actor, Permission.CONNECT_VOICE) || !can(actor, Permission.VIEW_CHANNELS)) return send({ type: "error", code: "forbidden", message: "no voice permission" });
          const [channel] = await db.select().from(channels).where(eq(channels.id, ev.data.channelId)).limit(1);
          if (!channel || channel.kind !== "voice") return send({ type: "error", code: "unknown_channel", message: `no such voice channel: ${ev.data.channelId}` });
          const [user] = await db.select({ publicKey: users.publicKey, displayName: users.displayName, handle: users.handle }).from(users).where(eq(users.id, userId)).limit(1);
          if (!user) return socket.close(4003, "unauthorized");
          presence.dropRestored(userId, socket);
          return presence.join(socket, channel.id, { userId, displayName: displayNameOf(user) });
        }
        case "voice.leave":
          presence.dropRestored(userId, socket);
          return presence.leave(socket);
        case "activity":
          // AFK detection: the hub turns the connections' reports into the member's state (index.ts broadcasts and moves).
          hub.setIdle(socket, ev.data.idle);
          // Game display: left out = the client says nothing about it (one from before the feature).
          if (ev.data.game !== undefined) reportGame(ev.data.game);
          return;
        case "typing": {
          const now = Date.now();
          if (now - lastTyping < 2000) return; // Throttling: at most every 2 s
          lastTyping = now;
          return hub.broadcast({ type: "typing", channelId: ev.data.channelId, userId }, socket);
        }
      }
    });

    socket.on("close", () => {
      clearTimeout(helloTimeout);
      if (gameTimer) clearTimeout(gameTimer);
      liveness.remove(socket);
      hub.remove(socket);
      presence.leave(socket);
      if (userId) req.log.info({ userId }, "ws closed");
    });
  });
}
