import { ClientEvent, PROTOCOL_VERSION, Permission, displayNameOf, type ServerEvent } from "@squorli/protocol";
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

/**
 * Real-time channel for everything except media: state after the handshake, presence, channel state, messages, typing.
 * State reconciliation by sequence number after a reconnect: the client reloads /api/state and the history (M2).
 */
export async function registerWs(app: FastifyInstance, db: Db, hub: Hub, presence: VoicePresence<WebSocket>, radioMeta: RadioMetadata) {
  const unsubscribe = presence.onChange((channelId, members) => {
    hub.broadcast({ type: "voice.state", channelId, members });
  });
  app.addHook("onClose", async () => unsubscribe());

  app.get("/api/ws", { websocket: true }, (socket: WebSocket, req) => {
    let userId: string | null = null;
    const send = (e: ServerEvent) => hub.send(socket, e);
    const helloTimeout = setTimeout(() => socket.close(4001, "hello timeout"), 10_000);
    let lastTyping = 0;

    socket.on("message", async (raw) => {
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
        req.log.info({ userId }, "ws connected");
        send({ type: "welcome", userId, serverTime: new Date().toISOString(), protocolVersion: PROTOCOL_VERSION, state: await loadState(db, hub, userId) });
        for (const ch of await loadChannels(db)) {
          if (ch.kind === "voice") send({ type: "voice.state", channelId: ch.id, members: presence.members(ch.id) });
          const title = radioMeta.titleOf(ch.id);
          if (title) send({ type: "radio.meta", channelId: ch.id, title });
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
          return presence.join(socket, channel.id, { userId, displayName: displayNameOf(user) });
        }
        case "voice.leave":
          return presence.leave(socket);
        case "activity":
          // AFK detection: the hub turns the connections' reports into the member's state (index.ts broadcasts and moves).
          return hub.setIdle(socket, ev.data.idle);
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
      hub.remove(socket);
      presence.leave(socket);
      if (userId) req.log.info({ userId }, "ws closed");
    });
  });
}
