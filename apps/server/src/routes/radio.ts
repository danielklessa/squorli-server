import { CreateRadioStationRequest, Permission, SetChannelRadioRequest, UpdateRadioStationRequest } from "@squorli/protocol";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can } from "../authz";
import type { Db } from "../db";
import { channels, radioStations } from "../db/schema";
import type { Hub } from "../hub";
import { resolveStreamUrl } from "../radio/resolve";
import { broadcastStructure } from "../state";
import { compact } from "../util";

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;
const MAX_STATIONS = 200;
const RADIO_OFF = { radioStationId: null, radioStreamUrl: null, radioStartedBy: null };

/**
 * Web radio. The station list belongs to the server (MANAGE_SERVER); tuning a voice channel to a station or turning the
 * radio off needs CONTROL_RADIO. The audio never passes through here: clients play `streamUrl` themselves, the server
 * only reads a station's playlist when the radio is started (radio/resolve.ts).
 */
/** `onRadioChange`: whatever changed what a channel plays, the "now playing" reader (radio/metadata.ts) follows. */
export async function registerRadioRoutes(app: FastifyInstance, db: Db, hub: Hub, onRadioChange: () => void) {
  // ---- Stations
  app.post("/api/radio/stations", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    const body = CreateRadioStationRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    if ((await db.$count(radioStations)) >= MAX_STATIONS) return reply.code(409).send({ error: "too_many_stations" });
    const [row] = await db.insert(radioStations).values(body.data).returning({ id: radioStations.id, name: radioStations.name, url: radioStations.url });
    await broadcastStructure(db, hub, ["radioStations"]);
    onRadioChange();
    return row;
  });

  app.patch<{ Params: { id: string } }>("/api/radio/stations/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    const body = UpdateRadioStationRequest.safeParse(req.body);
    if (!body.success || Object.keys(compact(body.data)).length === 0) return reply.code(400).send({ error: "bad_request" });
    const [before] = await db.select({ url: radioStations.url }).from(radioStations).where(eq(radioStations.id, req.params.id)).limit(1);
    if (!before) return reply.code(404).send({ error: "not_found" });
    const [row] = await db.update(radioStations).set(compact(body.data)).where(eq(radioStations.id, req.params.id)).returning({ id: radioStations.id, name: radioStations.name, url: radioStations.url });
    if (!row) return reply.code(404).send({ error: "not_found" });
    // A new address: channels still playing the old one are turned off instead of silently switching what everyone hears.
    if (row.url !== before.url) await db.update(channels).set(RADIO_OFF).where(eq(channels.radioStationId, row.id));
    await broadcastStructure(db, hub, ["radioStations", "channels"]); // channels carry the station's name
    onRadioChange();
    return row;
  });

  app.delete<{ Params: { id: string } }>("/api/radio/stations/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_SERVER)) return reply.code(403).send({ error: "forbidden" });
    await db.update(channels).set(RADIO_OFF).where(eq(channels.radioStationId, req.params.id));
    const gone = await db.delete(radioStations).where(eq(radioStations.id, req.params.id)).returning({ id: radioStations.id });
    if (!gone.length) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["radioStations", "channels"]);
    onRadioChange();
    return { ok: true };
  });

  // ---- Radio of a voice channel
  app.put<{ Params: { id: string } }>("/api/channels/:id/radio", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.CONTROL_RADIO)) return reply.code(403).send({ error: "forbidden" });
    const body = SetChannelRadioRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [station] = await db.select().from(radioStations).where(eq(radioStations.id, body.data.stationId)).limit(1);
    if (!station) return reply.code(404).send({ error: "unknown_station" });
    const resolved = await resolveStreamUrl(station.url);
    if (!resolved.ok) return reply.code(502).send({ error: `radio_${resolved.error}` });
    const [row] = await db.update(channels).set({ radioStationId: station.id, radioStreamUrl: resolved.streamUrl, radioStartedBy: m.actor.userId })
      .where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).returning({ id: channels.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["channels"]);
    onRadioChange();
    return { ok: true, streamUrl: resolved.streamUrl };
  });

  app.delete<{ Params: { id: string } }>("/api/channels/:id/radio", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.CONTROL_RADIO)) return reply.code(403).send({ error: "forbidden" });
    const [row] = await db.update(channels).set(RADIO_OFF).where(and(eq(channels.id, req.params.id), eq(channels.kind, "voice"))).returning({ id: channels.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    await broadcastStructure(db, hub, ["channels"]);
    onRadioChange();
    return { ok: true };
  });
}
