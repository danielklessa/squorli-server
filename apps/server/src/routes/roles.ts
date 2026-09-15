import { CreateRoleRequest, Permission, UpdateRoleRequest } from "@squorli/protocol";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { requireMember } from "../auth/session";
import { can, canGrant, canTouchRole } from "../authz";
import type { Db } from "../db";
import { roles } from "../db/schema";
import type { Hub } from "../hub";
import { broadcastStructure } from "../state";
import { compact } from "../util";

const Params = { type: "object", properties: { id: { type: "string", format: "uuid" } }, required: ["id"] } as const;

export async function registerRoleRoutes(app: FastifyInstance, db: Db, hub: Hub) {
  app.post("/api/roles", async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_ROLES)) return reply.code(403).send({ error: "forbidden" });
    const body = CreateRoleRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const permissions = body.data.permissions ?? 0;
    if (!canGrant(m.actor, permissions)) return reply.code(403).send({ error: "cannot_grant" });
    // New roles start just above the default role; order them afterwards via PATCH position.
    const [row] = await db.insert(roles).values({ name: body.data.name, color: body.data.color ?? null, permissions, position: 1 }).returning();
    await broadcastStructure(db, hub, ["roles"]);
    return row;
  });

  app.patch<{ Params: { id: string } }>("/api/roles/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_ROLES)) return reply.code(403).send({ error: "forbidden" });
    const body = UpdateRoleRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const [role] = await db.select().from(roles).where(eq(roles.id, req.params.id)).limit(1);
    if (!role) return reply.code(404).send({ error: "not_found" });
    if (!canTouchRole(m.actor, role.position)) return reply.code(403).send({ error: "role_above_you" });
    if (body.data.position !== undefined && !canTouchRole(m.actor, body.data.position)) return reply.code(403).send({ error: "position_above_you" });
    if (body.data.permissions !== undefined && !canGrant(m.actor, body.data.permissions)) return reply.code(403).send({ error: "cannot_grant" });
    if (role.isDefault && body.data.position !== undefined && body.data.position !== 0) return reply.code(400).send({ error: "default_role_position_fixed" });
    const [row] = await db.update(roles).set(compact(body.data)).where(eq(roles.id, role.id)).returning();
    await broadcastStructure(db, hub, ["roles"]);
    return row;
  });

  app.delete<{ Params: { id: string } }>("/api/roles/:id", { schema: { params: Params } }, async (req, reply) => {
    const m = await requireMember(db, req, reply);
    if (!m) return;
    if (!can(m.actor, Permission.MANAGE_ROLES)) return reply.code(403).send({ error: "forbidden" });
    const [role] = await db.select().from(roles).where(eq(roles.id, req.params.id)).limit(1);
    if (!role) return reply.code(404).send({ error: "not_found" });
    if (role.isDefault) return reply.code(400).send({ error: "default_role_undeletable" });
    if (!canTouchRole(m.actor, role.position)) return reply.code(403).send({ error: "role_above_you" });
    await db.delete(roles).where(eq(roles.id, role.id));
    await broadcastStructure(db, hub, ["roles", "members"]);
    return { ok: true };
  });
}
