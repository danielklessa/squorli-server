import { DEFAULT_EVERYONE_PERMISSIONS, DEFAULT_MEMBER_PERMISSIONS, Permission } from "@squorli/protocol";
import { and, count, eq, notInArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Config } from "./config";
import type { Db } from "./db";
import { bans, categories, channels, members, roles, serverSettings, users } from "./db/schema";
import { SETTINGS_ID } from "./state";

/**
 * Sorgt beim Start fuer einen benutzbaren Server: Einstellungen, Rollen Gast (Standard), Mitglied, Admin,
 * eine Kategorie mit Text- und Sprachkanal. Nutzer aus M0/M1 (vor Mitgliedschaften) werden einmalig Mitglied.
 */
export async function bootstrap(db: Db, config: Config, log: FastifyBaseLogger) {
  await db.insert(serverSettings).values({ id: SETTINGS_ID, name: config.SERVER_NAME }).onConflictDoNothing();

  // Frische Datenbank = keine Standardrolle. Nicht "keine Rollen" pruefen: Migration 0004 legt "Mitglied" auch in
  // leeren Datenbanken an, dann fehlten Gast und Admin (Fehler 14.09.2026). Bestehende Server (mit Standardrolle) bleiben unangetastet.
  const existing = await db.select({ name: roles.name, isDefault: roles.isDefault }).from(roles);
  if (!existing.some((r) => r.isDefault)) {
    const wanted = [
      { name: "Gast", permissions: DEFAULT_EVERYONE_PERMISSIONS, position: 0, isDefault: true },
      { name: "Mitglied", permissions: DEFAULT_MEMBER_PERMISSIONS, position: 1, color: "#3ba55c" },
      { name: "Admin", permissions: Permission.ADMINISTRATOR, position: 100, color: "#e67e22" },
    ].filter((w) => w.isDefault || !existing.some((r) => r.name === w.name));
    await db.insert(roles).values(wanted);
    log.info({ roles: wanted.map((r) => r.name) }, "Rollen angelegt (Gast = Standard: sehen + Sprache)");
  }

  const [cc] = await db.select({ n: count() }).from(channels);
  if ((cc?.n ?? 0) === 0) {
    const [cat] = await db.insert(categories).values({ name: "Allgemein", position: 0 }).returning();
    await db.insert(channels).values([
      { kind: "text", name: "allgemein", topic: "Willkommen", categoryId: cat!.id, position: 0 },
      { kind: "voice", name: "Lobby", categoryId: cat!.id, position: 1 },
    ]);
    log.info("Kanaele angelegt: #allgemein, Lobby");
  }

  // Einmalige Uebernahme: Nutzer, die vor der Mitgliederverwaltung angelegt wurden.
  const [mc] = await db.select({ n: count() }).from(members);
  if ((mc?.n ?? 0) === 0) {
    const banned = (await db.select({ userId: bans.userId }).from(bans)).map((b) => b.userId);
    const existing = await db.select({ id: users.id }).from(users).where(banned.length ? notInArray(users.id, banned) : undefined);
    if (existing.length) {
      await db.insert(members).values(existing.map((u) => ({ userId: u.id }))).onConflictDoNothing();
      log.info({ n: existing.length }, "bestehende Nutzer als Mitglieder uebernommen");
    }
  }

  const [s] = await db.select().from(serverSettings).where(eq(serverSettings.id, SETTINGS_ID)).limit(1);
  // Mehrere Eigentuemer (14.09.2026): der erste Eigentuemer bekommt einmalig members.is_owner, damit Liste und Rechte eine Quelle haben.
  if (s?.ownerId) await db.update(members).set({ isOwner: true }).where(and(eq(members.userId, s.ownerId), eq(members.isOwner, false)));
  if (!s?.ownerId) {
    log.warn(config.OWNER_PUBLIC_KEY
      ? `Kein Eigentuemer: der Schluessel ${config.OWNER_PUBLIC_KEY.slice(0, 8)}... wird es beim naechsten Login.`
      : "Kein Eigentuemer: der naechste Nutzer, der sich anmeldet, wird Eigentuemer (OWNER_PUBLIC_KEY setzt das fest).");
  }
}
