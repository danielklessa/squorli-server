// Smoke test against a running server on :3000 (pnpm dev or node dist/index.js).
// Covers: auth, owners, invites, structure (categories/channels/roles), permission hierarchy,
// messages with history and attachment, WebSocket (welcome/state, voice, typing), kick, ban, protocol version.
//
// The owner key is remembered in scripts/.smoke-owner.json (gitignored) so the test
// is repeatable against the same database. On the very first run it automatically becomes the owner.
import * as ed from "@noble/ed25519";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const PROTOCOL_VERSION = 4; // must match packages/protocol
const BASE = process.env.SMOKE_URL ?? "http://localhost:3000";
const OWNER_FILE = join(dirname(fileURLToPath(import.meta.url)), ".smoke-owner.json");
const hex = (b) => Buffer.from(b).toString("hex");
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? " " + detail : ""}`); if (!ok) failures++; };
const P = { ADMINISTRATOR: 1, MANAGE_CHANNELS: 4, KICK_MEMBERS: 16, VIEW_CHANNELS: 128, SEND_MESSAGES: 256, MANAGE_MESSAGES: 512, CONNECT_VOICE: 1024, STREAM_VIDEO: 4096, MODERATE_VOICE: 8192 };

async function api(method, path, body, token, raw = false, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  if (raw) return r;
  return [r.status, await r.json().catch(() => ({}))];
}

async function newKey() {
  const priv = ed.utils.randomPrivateKey();
  return { priv, publicKey: hex(await ed.getPublicKeyAsync(priv)) };
}
// Domain the server binds signatures to (PUBLIC_DOMAIN), taken from /api/health instead of a hardcoded "localhost".
const [, health] = await api("GET", "/api/health");
const DOMAIN = health.domain ?? "localhost";

async function login(key, invite, userAgent) {
  const [, ch] = await api("POST", "/api/auth/challenge", { publicKey: key.publicKey });
  const msg = `community-chat-login\n${DOMAIN}\n${ch.nonce}`;
  const signature = hex(await ed.signAsync(new TextEncoder().encode(msg), key.priv));
  const [status, body] = await api("POST", "/api/auth/verify", { challengeId: ch.challengeId, publicKey: key.publicKey, signature, ...(invite ? { invite } : {}) },
    undefined, false, userAgent ? { "user-agent": userAgent } : {});
  return { status, body, token: body.sessionToken, userId: body.userId };
}

// WebSocket client with an event buffer
async function connectWs(token) {
  const ws = new WebSocket(BASE.replace(/^http/, "ws") + "/api/ws");
  const events = [];
  const waiters = [];
  ws.on("message", (m) => { const e = JSON.parse(m.toString()); events.push(e); for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); } });
  await new Promise((r) => ws.on("open", r));
  const waitFor = (pred, ms = 4000) => new Promise((resolve, reject) => {
    const hit = events.find(pred); if (hit) return resolve(hit);
    const w = { pred, resolve }; waiters.push(w);
    setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error("timeout waiting for event")); }, ms);
  });
  let isClosed = false, closeCode = null;
  ws.on("close", (code) => { isClosed = true; closeCode = code; });
  const send = (e) => ws.send(JSON.stringify(e));
  const close = () => new Promise((r) => { if (isClosed) return r(); ws.once("close", r); ws.close(); });
  /** Waits for the close and returns the close code (null on timeout). */
  const closed = (ms = 4000) => new Promise((r) => { if (isClosed) return r(closeCode); ws.once("close", (code) => r(code)); setTimeout(() => r(null), ms); });
  send({ type: "hello", protocolVersion: PROTOCOL_VERSION, sessionToken: token });
  const welcome = await waitFor((e) => e.type === "welcome" || e.type === "error");
  return { ws, events, waitFor, send, close, closed, welcome };
}

// ---------- Owner
let ownerKey;
if (existsSync(OWNER_FILE)) {
  const j = JSON.parse(readFileSync(OWNER_FILE, "utf8"));
  ownerKey = { priv: Uint8Array.from(Buffer.from(j.priv, "hex")), publicKey: j.publicKey };
} else {
  ownerKey = await newKey();
  writeFileSync(OWNER_FILE, JSON.stringify({ priv: hex(ownerKey.priv), publicKey: ownerKey.publicKey }));
}
// Directory service (M6): if the server names one, give the owner key a handle there (201, or 409 if it already exists).
{
  const [, h] = await api("GET", "/api/health");
  if (h.directoryUrl) {
    const dir = h.directoryUrl;
    const dj = async (method, path, body) => { const r = await fetch(dir + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return [r.status, await r.json().catch(() => ({}))]; };
    const [, dh] = await dj("GET", "/api/health");
    const [, ch] = await dj("POST", "/api/challenge", { publicKey: ownerKey.publicKey });
    const handle = `smokeowner_${ownerKey.publicKey.slice(0, 6)}`;
    const sig = Buffer.from(await ed.signAsync(new TextEncoder().encode(`community-directory-register
${dh.host}
${handle}
${ch.nonce}`), ownerKey.priv)).toString("hex");
    const [sr, rr] = await dj("POST", "/api/register", { handle, publicKey: ownerKey.publicKey, challengeId: ch.challengeId, signature: sig });
    check("directory: owner handle registered or already present", sr === 201 || (sr === 409 && rr.error === "key_registered"), `${sr} ${rr.handle ?? handle}`);
  }
}

const owner = await login(ownerKey);
if (owner.status !== 200) {
  console.error(`FAIL Eigentuemer-Login: ${owner.status} ${JSON.stringify(owner.body)}. Wenn ${OWNER_FILE} fehlt und der Server schon einen Eigentuemer hat, Datei aus dem echten Eigentuemer-Schluessel anlegen oder DB zuruecksetzen.`);
  process.exitCode = 1;
  throw new Error("abgebrochen");
}
const [, ownerState] = await api("GET", "/api/state", undefined, owner.token);
check("owner login + state", ownerState.settings?.ownerId === owner.userId && (ownerState.myPermissions & P.ADMINISTRATOR) !== 0, `owner ${owner.userId.slice(0, 8)}`);
const [, health0] = await api("GET", "/api/health");
check("health names directory (null or url)", "directoryUrl" in health0 && ("handle" in ownerState.members.find((m) => m.userId === owner.userId)), `directory ${health0.directoryUrl ?? "keins"}`);
// With a directory service (M6): the owner's handle was looked up at sign-in (registered further above).
if (health0.directoryUrl) check("owner handle resolved via directory", typeof ownerState.members.find((m) => m.userId === owner.userId)?.handle === "string", ownerState.members.find((m) => m.userId === owner.userId)?.handle);
check("health publishes serverKey (directory registration)", /^[0-9a-f]{64}$/.test(health0.serverKey ?? ""));
// Display name from the directory: the server is registered there (token) and adopts the global/per-server name at sign-in; without an entry the local one stays.
if (health0.directoryUrl) {
  const dir = health0.directoryUrl;
  const dj = async (method, path, body) => { const r = await fetch(dir + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return [r.status, await r.json().catch(() => ({}))]; };
  const [, dh] = await dj("GET", "/api/health");
  const setName = async (server, displayName) => {
    const [, ch] = await dj("POST", "/api/challenge", { publicKey: ownerKey.publicKey });
    const msg = `community-directory-profile-update\n${dh.host}\n${ch.nonce}\n${server ?? ""}\n${displayName ?? ""}`;
    const signature = Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), ownerKey.priv)).toString("hex");
    return dj("POST", "/api/profile", { publicKey: ownerKey.publicKey, challengeId: ch.challengeId, signature, server, displayName });
  };
  const nameAfterLogin = async () => { const o = await login(ownerKey); const [, st] = await api("GET", "/api/state", undefined, o.token); return st.members.find((m) => m.userId === owner.userId)?.displayName; };
  const [sg] = await setName(null, "Smoke Global");
  check("directory: global display name applied at login", sg === 200 && (await nameAfterLogin()) === "Smoke Global");
  const [ss] = await setName(health0.domain.toLowerCase(), "Smoke Hier");
  check("directory: server display name wins at login", ss === 200 && (await nameAfterLogin()) === "Smoke Hier");
  const [spush] = await setName(health0.domain.toLowerCase(), "Smoke Push");
  await new Promise((r) => setTimeout(r, 800));
  const [, stPush] = await api("GET", "/api/state", undefined, owner.token);
  check("directory: name change is pushed to the server without a new login", spush === 200 && stPush.members.find((m) => m.userId === owner.userId)?.displayName === "Smoke Push", stPush.members.find((m) => m.userId === owner.userId)?.displayName);
  await setName(health0.domain.toLowerCase(), null);
  await setName(null, null);
  await new Promise((r) => setTimeout(r, 800)); // wait for the pushes before clearing the local name
  await api("PATCH", "/api/me", { displayName: null }, owner.token);
  const handleName = ownerState.members.find((m) => m.userId === owner.userId)?.handle;
  check("directory: names cleared -> local null stays, handle shown", (await nameAfterLogin()) === `@${handleName}`);
}
check("bootstrap created channels", ownerState.channels?.some((c) => c.kind === "text") && ownerState.channels?.some((c) => c.kind === "voice"));
const defaultRole = ownerState.roles.find((r) => r.isDefault);
check("default role exists", !!defaultRole);
check("default role = Gast: nur sehen + Sprache", defaultRole?.name === "Gast" && defaultRole.permissions === (P.VIEW_CHANNELS | P.CONNECT_VOICE));
const memberRole = ownerState.roles.find((r) => r.name === "Mitglied" && !r.isDefault);
check("role Mitglied exists", !!memberRole && (memberRole.permissions & P.SEND_MESSAGES) !== 0 && (memberRole.permissions & P.STREAM_VIDEO) !== 0);

// server not open (default) so the invite logic applies
await api("PATCH", "/api/settings", { openJoin: false, name: "Rauchtest-Server" }, owner.token);
const [, s2] = await api("GET", "/api/state", undefined, owner.token);
check("settings patch", s2.settings.name === "Rauchtest-Server" && s2.settings.openJoin === false);

// ---------- Structure
const [sc, cat] = await api("POST", "/api/categories", { name: "Smoke" }, owner.token);
const [st, textCh] = await api("POST", "/api/channels", { kind: "text", name: "smoke-text", categoryId: cat.id }, owner.token);
const [sv, voiceCh] = await api("POST", "/api/channels", { kind: "voice", name: "smoke-voice", categoryId: cat.id, audioBitrate: 96, audioStereo: true }, owner.token);
check("voice channel audio profile", voiceCh?.audioBitrate === 96 && voiceCh?.audioStereo === true);
const [sva] = await api("PATCH", `/api/channels/${voiceCh.id}`, { audioBitrate: 48, audioStereo: false }, owner.token);
const [, stAudio] = await api("GET", "/api/state", undefined, owner.token);
const chAudio = stAudio.channels.find((c) => c.id === voiceCh.id);
check("voice channel audio profile update", sva === 200 && chAudio?.audioBitrate === 48 && chAudio?.audioStereo === false);
const [svBad] = await api("PATCH", `/api/channels/${voiceCh.id}`, { audioBitrate: 9999 }, owner.token);
check("audio bitrate validated", svBad === 400);
check("create category + channels", sc === 200 && st === 200 && sv === 200);
const [sr, modRole] = await api("POST", "/api/roles", { name: "Smoke-Mod", permissions: P.KICK_MEMBERS | P.MANAGE_MESSAGES, color: "#3498db" }, owner.token);
check("create role", sr === 200 && modRole.position === 1);

// ---------- Invites
const [si, invite] = await api("POST", "/api/invites", { maxUses: 2 }, owner.token);
check("create invite", si === 200 && /^[A-Za-z0-9_-]{6,32}$/.test(invite.code));
const [sp, preview] = await api("GET", `/api/invites/${invite.code}`);
check("invite preview (public)", sp === 200 && preview.valid === true && preview.serverName === "Rauchtest-Server");

const keyB = await newKey();
const noInvite = await login(keyB);
check("join without invite rejected", noInvite.status === 403 && noInvite.body.error === "invite_required");
const badInvite = await login(keyB, "nope-nope-nope");
check("bad invite rejected", badInvite.status === 403 && badInvite.body.error === "invite_invalid");
const B = await login(keyB, invite.code);
check("join with invite", B.status === 200);
const B2 = await login(keyB); // Member: no longer needs an invite
check("member re-login without invite", B2.status === 200);

// ---------- Account required (admin): without a handle at the directory, 403 account_required; without a directory the option has no effect.
const [sra] = await api("PATCH", "/api/settings", { requireAccount: true }, owner.token);
const [, hra] = await api("GET", "/api/health");
const [, stRa] = await api("GET", "/api/state", undefined, owner.token);
check("require account: not locked by config in this run", stRa.settings.requireAccountLocked === false);
check("require account: patch, in state, in health (only with directory), version present", sra === 200 && stRa.settings.requireAccount === true
  && hra.requireAccount === !!hra.directoryUrl && typeof hra.version === "string" && hra.version.length > 0);
const keyNoAcc = await newKey();
const [, invRa] = await api("POST", "/api/invites", { maxUses: 1 }, owner.token);
const noAcc = await login(keyNoAcc, invRa.code);
if (hra.directoryUrl) check("require account: key without handle rejected", noAcc.status === 403 && noAcc.body.error === "account_required", `${noAcc.status} ${noAcc.body.error ?? ""}`);
else check("require account: without directory no effect", noAcc.status === 200, `${noAcc.status}`);
const ownerRa = await login(ownerKey);
check("require account: owner exempt, existing member without account", ownerRa.status === 200 && (await login(keyB)).status === (hra.directoryUrl ? 403 : 200));
await api("PATCH", "/api/settings", { requireAccount: false }, owner.token);

// ---------- Server directory (M6d): listing + description; with a directory the server re-registers and appears in its list
const [sld] = await api("PATCH", "/api/settings", { listed: true, description: "Rauchtest im Verzeichnis" }, owner.token);
const [, stLd] = await api("GET", "/api/state", undefined, owner.token);
check("listing: patch listed + description in state", sld === 200 && stLd.settings.listed === true && stLd.settings.description === "Rauchtest im Verzeichnis");
if (hra.directoryUrl) {
  await new Promise((r) => setTimeout(r, 3500)); // debounced re-registration (1.5 s) + fetch
  const dl = await fetch(`${hra.directoryUrl}/api/servers`).then(async (r) => [r.status, await r.json().catch(() => [])]);
  const mine = Array.isArray(dl[1]) ? dl[1].find((x) => x.host === health.domain) : null;
  check("listing: server appears in the directory with description and member count", dl[0] === 200 && !!mine && mine.description === "Rauchtest im Verzeichnis" && typeof mine.memberCount === "number", JSON.stringify(dl[1]));
  await api("PATCH", "/api/settings", { listed: false }, owner.token);
  await new Promise((r) => setTimeout(r, 3500));
  const dl2 = await fetch(`${hra.directoryUrl}/api/servers`).then((r) => r.json()).catch(() => []);
  check("listing: unlisted -> gone from the directory", Array.isArray(dl2) && !dl2.some((x) => x.host === health.domain));
} else {
  await api("PATCH", "/api/settings", { listed: false }, owner.token);
}
const [sldBad] = await api("PATCH", "/api/settings", { description: "x".repeat(201) }, owner.token);
check("listing: description too long -> 400", sldBad === 400);
await api("PATCH", "/api/me", { displayName: "Bea" }, B.token);

// ---------- Sessions / devices (M6c): list, label from the user agent, remote sign-out (WS close 4011), others, own
const [ssl0, sessList0] = await api("GET", "/api/me/sessions", undefined, B.token);
check("sessions list: exactly one current", ssl0 === 200 && Array.isArray(sessList0) && sessList0.filter((s) => s.current).length === 1 && sessList0.length >= 2, `${sessList0.length ?? "?"} Sitzungen`);
const B3 = await login(keyB, undefined, "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0");
const [, sessList1] = await api("GET", "/api/me/sessions", undefined, B.token);
const firefox = sessList1.find((s) => s.label === "Firefox auf Windows");
check("session label from user-agent", B3.status === 200 && !!firefox && firefox.current === false && sessList1.length === sessList0.length + 1, sessList1.map((s) => s.label).join(", "));
const wsB3 = await connectWs(B3.token);
const [srv1] = await api("DELETE", `/api/me/sessions/${firefox?.id}`, undefined, B.token);
const closeCode3 = await wsB3.closed();
const [sme3] = await api("GET", "/api/me", undefined, B3.token);
check("revoke session: ws closed 4011, token dead", srv1 === 200 && closeCode3 === 4011 && sme3 === 401, `close ${closeCode3}, me ${sme3}`);
const [srv2] = await api("DELETE", "/api/me/sessions/00000000-0000-4000-8000-000000000000", undefined, B.token);
const [, ownerSess] = await api("GET", "/api/me/sessions", undefined, owner.token);
const [srv3] = await api("DELETE", `/api/me/sessions/${ownerSess.find((s) => s.current)?.id}`, undefined, B.token);
const [srv4] = await api("DELETE", "/api/me/sessions/nope", undefined, B.token);
const [smeOwner] = await api("GET", "/api/me", undefined, owner.token);
check("revoke unknown/foreign/bad id -> 404/404/400, owner untouched", srv2 === 404 && srv3 === 404 && srv4 === 400 && smeOwner === 200);
const [srv5, others] = await api("DELETE", "/api/me/sessions/others", undefined, B.token);
const [sme2] = await api("GET", "/api/me", undefined, B2.token);
const [sme1] = await api("GET", "/api/me", undefined, B.token);
check("revoke others: B2 dead, B alive", srv5 === 200 && others.revoked >= 1 && sme2 === 401 && sme1 === 200, `revoked ${others.revoked}`);
const B4 = await login(keyB);
const [srv6] = await api("DELETE", "/api/me/sessions/current", undefined, B4.token);
const [sme4] = await api("GET", "/api/me", undefined, B4.token);
check("logout current session -> token dead", srv6 === 200 && sme4 === 401);

// Freshly joined = guest: may not post until an admin grants "member".
const [sg1] = await api("POST", `/api/channels/${ownerState.channels.find((c) => c.kind === "text").id}/messages`, { content: "Gast?" }, B.token);
const [sg2] = await api("POST", "/api/rtc-token", { channelId: ownerState.channels.find((c) => c.kind === "voice").id }, B.token);
check("guest cannot write but may join voice", sg1 === 403 && sg2 === 200);
await api("PUT", `/api/members/${B.userId}/roles`, { roleIds: [memberRole.id] }, owner.token);

// ---------- Permissions
const [sb1] = await api("POST", "/api/channels", { kind: "text", name: "nope" }, B.token);
check("member cannot create channels", sb1 === 403);
const [sb2] = await api("DELETE", `/api/members/${owner.userId}`, undefined, B.token);
check("member cannot kick", sb2 === 403);
const [sar] = await api("PUT", `/api/members/${B.userId}/roles`, { roleIds: [memberRole.id, modRole.id] }, owner.token);
const [, stB] = await api("GET", "/api/state", undefined, B.token);
check("assign role -> permissions update", sar === 200 && (stB.myPermissions & P.KICK_MEMBERS) !== 0 && stB.members.find((m) => m.userId === B.userId)?.roleIds.includes(modRole.id));
// ---------- Multiple owners: only owners can appoint, permissions follow immediately, the first owner stays
const [so0] = await api("PUT", `/api/members/${B.userId}/owner`, { owner: true }, B.token);
check("non-owner cannot grant owner", so0 === 403);
const [so1] = await api("PUT", `/api/members/${B.userId}/owner`, { owner: true }, owner.token);
const [, stOwn] = await api("GET", "/api/state", undefined, B.token);
check("grant owner -> isOwner + ADMINISTRATOR", so1 === 200 && stOwn.members.find((m) => m.userId === B.userId)?.isOwner === true && (stOwn.myPermissions & P.ADMINISTRATOR) !== 0);
const [so2, ro2] = await api("PUT", `/api/members/${owner.userId}/owner`, { owner: false }, B.token);
const [so2b, ro2b] = await api("PUT", `/api/members/${B.userId}/owner`, { owner: false }, B.token);
check("founder cannot be demoted, not self", so2 === 403 && ro2.error === "founder" && so2b === 400 && ro2b.error === "self");
const [so3] = await api("PUT", `/api/members/${B.userId}/owner`, { owner: false }, owner.token);
const [, stOwn2] = await api("GET", "/api/state", undefined, B.token);
check("revoke owner -> back to role permissions", so3 === 200 && stOwn2.members.find((m) => m.userId === B.userId)?.isOwner === false && (stOwn2.myPermissions & P.ADMINISTRATOR) === 0 && stOwn2.members.find((m) => m.userId === owner.userId)?.isOwner === true);

// ---------- Server icon (admin): upload, serving, favicon URL in /api/health, rejections, removal
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const pngForm = () => { const f = new FormData(); f.append("file", new Blob([PNG1], { type: "image/png" }), "icon.png"); return f; };
const [si1, ri1] = await api("PUT", "/api/settings/icon", pngForm(), owner.token);
const [, stIcon] = await api("GET", "/api/state", undefined, owner.token);
const iconRes = await api("GET", stIcon.settings.iconUrl ?? "/api/server-icon", undefined, undefined, true);
const [, hIcon] = await api("GET", "/api/health");
check("server icon: upload, iconUrl, served as png, in health with server name", si1 === 200 && typeof stIcon.settings.iconUrl === "string" && ri1.iconUrl === stIcon.settings.iconUrl && iconRes.status === 200
  && iconRes.headers.get("content-type")?.startsWith("image/png") && hIcon.iconUrl === stIcon.settings.iconUrl && hIcon.serverName === "Rauchtest-Server", `${si1} ${ri1.error ?? ""}`);
const fdSvg = new FormData(); fdSvg.append("file", new Blob(["<svg/>"], { type: "image/svg+xml" }), "x.svg");
const [si2, ri2] = await api("PUT", "/api/settings/icon", fdSvg, owner.token);
const [si3] = await api("PUT", "/api/settings/icon", pngForm(), B.token);
const [si4] = await api("DELETE", "/api/settings/icon", undefined, owner.token);
const [, stIcon2] = await api("GET", "/api/state", undefined, owner.token);
const iconGone = await api("GET", "/api/server-icon", undefined, undefined, true);
check("server icon: svg rejected, non-admin rejected, delete", si2 === 400 && ri2.error === "bad_type" && si3 === 403 && si4 === 200 && stIcon2.settings.iconUrl === null && iconGone.status === 404);

const [sb3, kickOwner] = await api("DELETE", `/api/members/${owner.userId}`, undefined, B.token);
check("mod cannot kick owner", sb3 === 403 && kickOwner.error === "target_above_you");
const [sb4] = await api("PATCH", `/api/roles/${modRole.id}`, { permissions: P.ADMINISTRATOR }, B.token);
check("mod cannot escalate role", sb4 === 403);

// ---------- WebSocket + messages
const wsA = await connectWs(owner.token);
check("ws welcome with state", wsA.welcome.type === "welcome" && wsA.welcome.state.channels.some((c) => c.id === textCh.id));
const wsB = await connectWs(B.token);
const [, stOnline] = await api("GET", "/api/state", undefined, owner.token);
check("presence online", stOnline.members.find((m) => m.userId === B.userId)?.online === true);

const [sm1, msg1] = await api("POST", `/api/channels/${textCh.id}/messages`, { content: "Hallo aus dem Rauchtest" }, B.token);
const evCreate = await wsA.waitFor((e) => e.type === "message.create" && e.message?.id === msg1.id).catch(() => null);
check("message create + broadcast", sm1 === 200 && !!evCreate && evCreate.message.authorId === B.userId);
const [sm2] = await api("PATCH", `/api/messages/${msg1.id}`, { content: "Hallo (bearbeitet)" }, B.token);
const evUpdate = await wsA.waitFor((e) => e.type === "message.update" && e.message?.id === msg1.id).catch(() => null);
check("message edit by author", sm2 === 200 && evUpdate?.message.editedAt !== null);
const [sm3] = await api("PATCH", `/api/messages/${msg1.id}`, { content: "x" }, owner.token);
check("edit foreign message rejected", sm3 === 403);
const [sm4] = await api("POST", `/api/channels/${voiceCh.id}/messages`, { content: "x" }, B.token);
check("no text in voice channel", sm4 === 404);
const [smEmpty] = await api("POST", `/api/channels/${textCh.id}/messages`, { content: "   " }, B.token);
check("empty message rejected", smEmpty === 400);

// Attachment
const fd = new FormData();
fd.append("file", new Blob(["hallo datei"], { type: "text/plain" }), "notiz.txt");
const [su, att] = await api("POST", "/api/attachments", fd, B.token);
check("upload attachment", su === 200 && att.size === 11 && att.url.startsWith("/api/attachments/"));
const [sm5, msg2] = await api("POST", `/api/channels/${textCh.id}/messages`, { content: "", attachmentIds: [att.id] }, B.token);
check("message with attachment", sm5 === 200 && msg2.attachments?.[0]?.id === att.id);
const dl = await api("GET", att.url, undefined, undefined, true);
check("download attachment", dl.status === 200 && (await dl.text()) === "hallo datei" && dl.headers.get("content-type")?.startsWith("text/plain"));
const [sm6] = await api("POST", `/api/channels/${textCh.id}/messages`, { content: "", attachmentIds: [att.id] }, B.token);
check("attachment cannot be reused", sm6 === 400);

// History + cursor
for (let i = 0; i < 3; i++) await api("POST", `/api/channels/${textCh.id}/messages`, { content: `n${i}` }, owner.token);
const [sh, page1] = await api("GET", `/api/channels/${textCh.id}/messages?limit=2`, undefined, B.token);
const [, page2] = await api("GET", `/api/channels/${textCh.id}/messages?limit=10&before=${page1.messages[0].seq}`, undefined, B.token);
check("history paging", sh === 200 && page1.messages.length === 2 && page1.hasMore === true && page2.messages.length === 3 && page2.hasMore === false
  && page2.messages[0].id === msg1.id, `seq ${page1.messages.map((m) => m.seq)} | ${page2.messages.map((m) => m.seq)}`);

// Deleting: a mod may delete others' messages, the author their own
const [sd1] = await api("DELETE", `/api/messages/${page1.messages[1].id}`, undefined, B.token);
const evDel = await wsA.waitFor((e) => e.type === "message.delete" && e.id === page1.messages[1].id).catch(() => null);
check("mod deletes foreign message", sd1 === 200 && !!evDel);
const [sd2] = await api("DELETE", `/api/messages/${msg2.id}`, undefined, B.token);
const dlGone = await api("GET", att.url, undefined, undefined, true);
check("delete own message removes attachment", sd2 === 200 && dlGone.status === 404);

// Typing + voice channel
wsB.send({ type: "typing", channelId: textCh.id });
const evTyping = await wsA.waitFor((e) => e.type === "typing" && e.userId === B.userId).catch(() => null);
check("typing forwarded", !!evTyping);
wsB.send({ type: "voice.join", channelId: voiceCh.id });
const evVoice = await wsA.waitFor((e) => e.type === "voice.state" && e.channelId === voiceCh.id && e.members.some((m) => m.userId === B.userId)).catch(() => null);
check("voice.join broadcast", evVoice?.members[0]?.displayName === "Bea");
wsB.send({ type: "voice.join", channelId: textCh.id });
const evVoiceErr = await wsB.waitFor((e) => e.type === "error" && e.code === "unknown_channel").catch(() => null);
check("voice.join text channel rejected", !!evVoiceErr);
const [srt] = await api("POST", "/api/rtc-token", { channelId: voiceCh.id }, B.token);
const [srt2] = await api("POST", "/api/rtc-token", { channelId: textCh.id }, B.token);
check("rtc-token voice only", srt === 200 && srt2 === 404);
// M3: camera/screen only with STREAM_VIDEO; LiveKit enforces this via canPublishSources in the token.
const grantOf = (tok) => JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString()).video;
const [, ownerTok] = await api("POST", "/api/rtc-token", { channelId: voiceCh.id }, owner.token);
check("rtc-token owner: mic+camera+screen+screen audio", ["microphone", "camera", "screen_share", "screen_share_audio"].every((x) => grantOf(ownerTok.token).canPublishSources?.includes(x)));
await api("PATCH", `/api/roles/${memberRole.id}`, { permissions: memberRole.permissions & ~P.STREAM_VIDEO }, owner.token);
const [, bTok] = await api("POST", "/api/rtc-token", { channelId: voiceCh.id }, B.token);
check("rtc-token ohne STREAM_VIDEO: nur Mikrofon", JSON.stringify(grantOf(bTok.token).canPublishSources) === JSON.stringify(["microphone"]));
await api("PATCH", `/api/roles/${memberRole.id}`, { permissions: memberRole.permissions }, owner.token);

// ---------- Voice channel moderation (M3): move, stop camera/screen, block streaming
const [, voiceCh2] = await api("POST", "/api/channels", { kind: "voice", name: "smoke-voice-2", categoryId: cat.id }, owner.token);
const [smv0] = await api("POST", `/api/members/${owner.userId}/move`, { channelId: voiceCh2.id }, B.token);
check("move without MODERATE_VOICE rejected", smv0 === 403);
const [smv1] = await api("POST", `/api/members/${B.userId}/move`, { channelId: voiceCh2.id }, owner.token);
const evMoved = await wsB.waitFor((e) => e.type === "voice.moved").catch(() => null);
check("move -> voice.moved at target", smv1 === 200 && evMoved?.channelId === voiceCh2.id && typeof evMoved.by === "string");
const [sst] = await api("POST", `/api/members/${B.userId}/stream/stop`, {}, owner.token);
const evStop = await wsB.waitFor((e) => e.type === "voice.stop").catch(() => null);
check("stop streams -> voice.stop at target", sst === 200 && evStop?.camera === true && evStop?.screen === true);
const [sblk] = await api("PUT", `/api/members/${B.userId}/stream`, { blocked: true }, owner.token);
const evMeBlocked = await wsB.waitFor((e) => e.type === "me" && (e.myPermissions & P.STREAM_VIDEO) === 0).catch(() => null);
const [, blockedTok] = await api("POST", "/api/rtc-token", { channelId: voiceCh.id }, B.token);
const [, stBlocked] = await api("GET", "/api/state", undefined, owner.token);
check("stream block: me without STREAM_VIDEO, token mic only, member flag", sblk === 200 && !!evMeBlocked
  && JSON.stringify(grantOf(blockedTok.token).canPublishSources) === JSON.stringify(["microphone"])
  && stBlocked.members.find((x) => x.userId === B.userId)?.streamBlocked === true);
await api("PUT", `/api/members/${B.userId}/stream`, { blocked: false }, owner.token);
const [, unblockedTok] = await api("POST", "/api/rtc-token", { channelId: voiceCh.id }, B.token);
check("stream unblock restores camera grant", grantOf(unblockedTok.token).canPublishSources?.includes("camera"));
const [smv2] = await api("POST", `/api/members/${B.userId}/move`, { channelId: null }, owner.token);
const evMovedOut = await wsB.waitFor((e) => e.type === "voice.moved" && e.channelId === null).catch(() => null);
check("move out of voice -> voice.moved null", smv2 === 200 && !!evMovedOut);
await api("DELETE", `/api/channels/${voiceCh2.id}`, undefined, owner.token);

// ---------- Kick / ban
const keyC = await newKey();
const C = await login(keyC, invite.code);
check("second invite use", C.status === 200);
const keyD = await newKey();
const D = await login(keyD, invite.code);
check("invite exhausted", D.status === 403 && D.body.error === "invite_invalid");
const wsC = await connectWs(C.token);
const removedP = wsC.waitFor((e) => e.type === "removed");
const [sk] = await api("DELETE", `/api/members/${C.userId}`, undefined, B.token);
const removed = await removedP.catch(() => null);
await wsC.closed();
const [skState] = await api("GET", "/api/state", undefined, C.token);
check("kick: removed event, socket closed, no longer member", sk === 200 && removed?.reason === "kicked" && skState === 403);
const [sinv2, invite2] = await api("POST", "/api/invites", {}, owner.token);
const [sbn] = await api("POST", "/api/bans", { userId: C.userId, reason: "Rauchtest" }, owner.token);
const Cagain = await login(keyC, invite2.code);
check("ban blocks re-join", sinv2 === 200 && sbn === 200 && Cagain.status === 403 && Cagain.body.error === "banned");
const [sbl, banList] = await api("GET", "/api/bans", undefined, owner.token);
check("ban list", sbl === 200 && banList.some((b) => b.userId === C.userId && b.reason === "Rauchtest"));
const [sub] = await api("DELETE", `/api/bans/${C.userId}`, undefined, owner.token);
const Cback = await login(keyC, invite2.code);
check("unban + rejoin", sub === 200 && Cback.status === 200);
const [sbanSelf] = await api("POST", "/api/bans", { userId: owner.userId }, owner.token);
check("cannot ban self", sbanSelf === 400);

// ---------- Account deletion via the directory (signed server-leave there): the directory pushes /api/directory/leave, the server
// confirms with its token and deletes the user (ws close 4012, token dead, member gone); the first owner is refused.
if (health0.directoryUrl) {
  const dir = health0.directoryUrl;
  const dj = async (method, path, body) => { const r = await fetch(dir + path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); return [r.status, await r.json().catch(() => ({}))]; };
  const [, dh] = await dj("GET", "/api/health");
  const dsigned = async (key, action, path, payload, extra = {}) => {
    const [, ch] = await dj("POST", "/api/challenge", { publicKey: key.publicKey });
    const signature = hex(await ed.signAsync(new TextEncoder().encode(`community-directory-${action}\n${dh.host}\n${ch.nonce}\n${payload}`), key.priv));
    return dj("POST", path, { publicKey: key.publicKey, challengeId: ch.challengeId, signature, ...extra });
  };
  const host = health0.domain.toLowerCase();
  const [, chC] = await dj("POST", "/api/challenge", { publicKey: keyC.publicKey });
  const handleC = `smokeleave_${keyC.publicKey.slice(0, 6)}`;
  const sigC = hex(await ed.signAsync(new TextEncoder().encode(`community-directory-register\n${dh.host}\n${handleC}\n${chC.nonce}`), keyC.priv));
  const [srC] = await dj("POST", "/api/register", { handle: handleC, publicKey: keyC.publicKey, challengeId: chC.challengeId, signature: sigC });
  const Cl = await login(keyC); // the sign-in makes the server look the key up with its token = listed at the directory
  const wsCl = await connectWs(Cl.token);
  check("leave: handle for C, signed in, listed at the directory", (srC === 201 || srC === 409) && Cl.status === 200 && wsCl.welcome.type === "welcome", `${srC} ${Cl.status}`);
  const [slo, rlo] = await dsigned(ownerKey, "server-leave", "/api/servers/leave", host, { server: host });
  const [smeO] = await api("GET", "/api/me", undefined, owner.token);
  check("leave: first owner refused (409 founder), owner untouched", slo === 409 && rlo.error === "founder" && smeO === 200, `${slo} ${rlo.error ?? ""}`);
  const [slc, rlc] = await dsigned(keyC, "server-leave", "/api/servers/leave", host, { server: host });
  const closeC = await wsCl.closed();
  const [smeC] = await api("GET", "/api/me", undefined, Cl.token);
  const [, stL] = await api("GET", "/api/state", undefined, owner.token);
  check("leave: delivered, ws closed 4012, token dead, member gone", slc === 200 && rlc.delivered === true && closeC === 4012 && smeC === 401 && !stL.members.some((m) => m.userId === C.userId),
    `${slc} ${JSON.stringify(rlc)} close ${closeC} me ${smeC}`);
  const [, dst] = await dsigned(keyC, "account-status", "/api/account/status", "");
  check("leave: server gone from the account's server list", Array.isArray(dst.servers) && !dst.servers.some((s) => s.host === host), JSON.stringify(dst.servers));
  const Cnew = await login(keyC, invite2.code);
  check("leave: joining again afterwards creates a new user", Cnew.status === 200 && Cnew.userId !== C.userId, `${Cnew.status}`);
  await api("DELETE", `/api/members/${Cnew.userId}`, undefined, owner.token);
}

// ---------- Protocol version
const wsOld = new WebSocket(BASE.replace(/^http/, "ws") + "/api/ws");
await new Promise((r) => wsOld.on("open", r));
wsOld.send(JSON.stringify({ type: "hello", protocolVersion: 99, sessionToken: owner.token }));
const vErr = JSON.parse(await new Promise((r) => wsOld.once("message", (m) => r(m.toString()))));
check("ws rejects v99", vErr.type === "error" && vErr.code === "protocol_version");
await new Promise((r) => wsOld.once("close", r));

// ---------- Cleanup
await wsA.close(); await wsB.close();
await api("DELETE", `/api/invites/${invite.code}`, undefined, owner.token);
await api("DELETE", `/api/invites/${invite2.code}`, undefined, owner.token);
await api("DELETE", `/api/channels/${textCh.id}`, undefined, owner.token);
await api("DELETE", `/api/channels/${voiceCh.id}`, undefined, owner.token);
await api("DELETE", `/api/categories/${cat.id}`, undefined, owner.token);
await api("DELETE", `/api/roles/${modRole.id}`, undefined, owner.token);
for (const u of [B, C]) await api("DELETE", `/api/members/${u.userId}`, undefined, owner.token);
const [, finalState] = await api("GET", "/api/state", undefined, owner.token);
check("cleanup", !finalState.channels.some((c) => c.id === textCh.id) && !finalState.roles.some((r) => r.id === modRole.id));

console.log(failures ? `\n${failures} Pruefung(en) fehlgeschlagen` : "\nalles ok");
process.exitCode = failures ? 1 : 0;
