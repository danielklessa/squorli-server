import { ChallengeRequest, VerifyRequest, challengeMessage, labelFromUserAgent } from "@squorli/protocol";
import * as ed from "@noble/ed25519";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import type { Config } from "../config";
import type { Db } from "../db";
import { bans, invites, memberRoles, members, roles, serverSettings, sessions, users } from "../db/schema";
import type { Hub } from "../hub";
import { SETTINGS_ID, broadcastStructure, loadSettings } from "../state";
import type { DirectoryClient } from "../directory";
import { ChallengeStore } from "./challenges";

const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

export async function registerAuthRoutes(app: FastifyInstance, db: Db, config: Config, hub: Hub, directory: DirectoryClient) {
  const challenges = new ChallengeStore();
  const sweeper = setInterval(() => challenges.sweep(), 30_000);
  app.addHook("onClose", async () => clearInterval(sweeper));

  app.post("/api/auth/challenge", async (req, reply) => {
    const body = ChallengeRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    return challenges.create(body.data.publicKey);
  });

  app.post("/api/auth/verify", async (req, reply) => {
    const body = VerifyRequest.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request" });
    const { challengeId, publicKey, signature, invite } = body.data;

    const nonce = challenges.consume(challengeId, publicKey);
    if (!nonce) return reply.code(401).send({ error: "challenge_invalid" });

    const msg = new TextEncoder().encode(challengeMessage(config.PUBLIC_DOMAIN, nonce));
    const ok = await ed.verifyAsync(hexToBytes(signature), msg, hexToBytes(publicKey)).catch(() => false);
    if (!ok) return reply.code(401).send({ error: "signature_invalid" });

    // Nutzer anlegen oder laden. Erste Anmeldung = Registrierung.
    const [user] = await db
      .insert(users)
      .values({ publicKey })
      .onConflictDoUpdate({ target: users.publicKey, set: { lastSeenAt: new Date() } })
      .returning();
    if (!user) return reply.code(500).send({ error: "user_upsert_failed" });

    const [ban] = await db.select().from(bans).where(eq(bans.userId, user.id)).limit(1);
    if (ban) return reply.code(403).send({ error: "banned", reason: ban.reason });

    // Verifiziertes Handle und Anzeigename aus dem Verzeichnis (M6) nachschlagen; Ausfall des Dienstes ist kein Login-Fehler.
    const profile = await directory.refresh({ id: user.id, publicKey, displayName: user.displayName });

    const [member] = await db.select().from(members).where(eq(members.userId, user.id)).limit(1);
    const settings = await loadSettings(db);
    const firstEver = settings.ownerId === null && (config.OWNER_PUBLIC_KEY === undefined || config.OWNER_PUBLIC_KEY === publicKey);
    // Nur mit Konto (Verwaltung): der Schluessel braucht ein Handle beim Verzeichnis. Eigentuemer und der erste Login sind
    // ausgenommen (kein Aussperren). Ist das Verzeichnis gerade nicht erreichbar, zaehlt das zuletzt gecachte Handle.
    if (settings.requireAccount && config.DIRECTORY_URL && !member?.isOwner && !firstEver) {
      const handle = profile ? profile.handle : user.handle;
      if (!handle) return reply.code(403).send({ error: "account_required" });
    }

    // Mitgliedschaft: bestehendes Mitglied, offener Server, oder gueltige Einladung.
    if (!member) {
      if (!settings.openJoin && !firstEver) {
        if (!invite) return reply.code(403).send({ error: "invite_required" });
        const used = await consumeInvite(db, invite);
        if (!used) return reply.code(403).send({ error: "invite_invalid" });
      }
      await db.insert(members).values({ userId: user.id }).onConflictDoNothing();
      req.log.info({ userId: user.id, via: invite ? "invite" : firstEver ? "owner" : "open" }, "neues Mitglied");
    }

    // Eigentuemer festlegen: erster passender Login, solange keiner existiert.
    if (firstEver) {
      await db.update(serverSettings).set({ ownerId: user.id }).where(and(eq(serverSettings.id, SETTINGS_ID), isNull(serverSettings.ownerId)));
      await db.update(members).set({ isOwner: true }).where(eq(members.userId, user.id));
      const [admin] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, "Admin")).limit(1);
      if (admin) await db.insert(memberRoles).values({ userId: user.id, roleId: admin.id }).onConflictDoNothing();
      req.log.warn({ userId: user.id, publicKey: publicKey.slice(0, 8) }, "Eigentuemer festgelegt");
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);
    // Geraetebezeichnung fuer die Sitzungsliste (M6c); der Client kann sie nicht setzen, nur der Browser verraet sie.
    await db.insert(sessions).values({ token, userId: user.id, expiresAt, label: labelFromUserAgent(req.headers["user-agent"]), lastUsedAt: new Date() });

    if (!member) await broadcastStructure(db, hub, ["members", "settings"]);
    return { sessionToken: token, userId: user.id, expiresAt: expiresAt.toISOString() };
  });
}

/** Einladung pruefen und verbrauchen (atomar). true = gueltig und gezaehlt. */
async function consumeInvite(db: Db, code: string): Promise<boolean> {
  const updated = await db
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(and(
      eq(invites.code, code),
      isNull(invites.revokedAt),
      sql`(${invites.expiresAt} is null or ${invites.expiresAt} > now())`,
      sql`(${invites.maxUses} is null or ${invites.uses} < ${invites.maxUses})`,
    ))
    .returning({ code: invites.code });
  return updated.length > 0;
}

export { resolveSession } from "./session";
