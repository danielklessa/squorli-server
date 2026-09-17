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
const P = { ADMINISTRATOR: 1, MANAGE_CHANNELS: 4, KICK_MEMBERS: 16, VIEW_CHANNELS: 128, SEND_MESSAGES: 256, MANAGE_MESSAGES: 512, CONNECT_VOICE: 1024, STREAM_VIDEO: 4096, MODERATE_VOICE: 8192, VIEW_VIDEO: 16384 };

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
    // Only a waiter that is still waiting times out: for one already served indexOf is -1, and splice(-1) would remove somebody else's.
    setTimeout(() => { const i = waiters.indexOf(w); if (i < 0) return; waiters.splice(i, 1); reject(new Error("timeout waiting for event")); }, ms);
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
  // This test registers accounts at the server's directory. Never at a real one: a test server started next to a `.env`
  // with a production DIRECTORY_URL inherits it (happened on 17 September 2026). Start it with `DIRECTORY_URL=` instead.
  if (h.directoryUrl && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(h.directoryUrl) && process.env.SMOKE_ALLOW_REMOTE_DIRECTORY !== "1") {
    console.error(`FAIL Der Server nennt das Verzeichnis ${h.directoryUrl}: der Rauchtest legt dort Konten an und laeuft deshalb nur gegen ein lokales Verzeichnis. Server mit DIRECTORY_URL= (leer) oder einem lokalen Verzeichnis starten; bewusst trotzdem: SMOKE_ALLOW_REMOTE_DIRECTORY=1.`);
    process.exit(1);
  }
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
check("role Mitglied exists", !!memberRole && (memberRole.permissions & P.SEND_MESSAGES) !== 0 && (memberRole.permissions & P.STREAM_VIDEO) !== 0 && (memberRole.permissions & P.VIEW_VIDEO) !== 0);

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

// ---------- Web radio (stations: MANAGE_SERVER; a voice channel's radio: CONTROL_RADIO; B has neither here)
const radioOf = async () => (await api("GET", "/api/state", undefined, owner.token))[1].channels.find((c) => c.id === voiceCh.id)?.radio ?? null;
// The voice channel is empty during these checks: keep the idle stop (checked at the end of this block) out of their way.
await api("PATCH", "/api/settings", { radioAutoStop: false }, owner.token);
const streamUrl = "https://streams.radiobob.de/bob-national/mp3-128/streams.radiobob.de/";
const [srs0] = await api("POST", "/api/radio/stations", { name: "Fremd", url: streamUrl }, B.token);
const [srsFtp] = await api("POST", "/api/radio/stations", { name: "Kaputt", url: "ftp://example.org/radio.mp3" }, owner.token);
const [srs2] = await api("POST", "/api/radio/stations", { name: "", url: streamUrl }, owner.token);
const [srs3, station] = await api("POST", "/api/radio/stations", { name: "Rauchtest-Radio", url: streamUrl }, owner.token);
const evStations = await wsB.waitFor((e) => e.type === "structure" && e.radioStations?.some((x) => x.id === station.id)).catch(() => null);
check("radio: stations need MANAGE_SERVER and an http(s) address; list in state and broadcast", srs0 === 403 && srsFtp === 400 && srs2 === 400 && srs3 === 200 && !!evStations
  && Array.isArray(stOnline.radioStations) && Array.isArray(wsA.welcome.state.radioStations), `${srs0} ${srsFtp} ${srs2} ${srs3}`);
const [srp0] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { stationId: station.id }, B.token);
const [srp1] = await api("PUT", `/api/channels/${textCh.id}/radio`, { stationId: station.id }, owner.token);
const [srp2, unknownStation] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { stationId: "00000000-0000-4000-8000-000000000000" }, owner.token);
const [srp3] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { stationId: station.id }, owner.token);
const evRadio = await wsB.waitFor((e) => e.type === "structure" && e.channels?.find((c) => c.id === voiceCh.id)?.radio?.stationId === station.id).catch(() => null);
const radioOn = evRadio?.channels.find((c) => c.id === voiceCh.id)?.radio;
check("radio: start needs CONTROL_RADIO, a voice channel and a known station; everyone gets the stream address", srp0 === 403 && srp1 === 404 && srp2 === 404 && unknownStation.error === "unknown_station" && srp3 === 200
  && radioOn?.streamUrl === streamUrl && radioOn?.name === "Rauchtest-Radio" && radioOn?.startedBy === owner.userId, `${srp0} ${srp1} ${srp2} ${srp3}`);
const [, internalStation] = await api("POST", "/api/radio/stations", { name: "Intern", url: "http://127.0.0.1:9/intern.m3u" }, owner.token);
const [srp4, internalErr] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { stationId: internalStation.id }, owner.token);
check("radio: a playlist on an internal address is never fetched, the running station stays", srp4 === 502 && internalErr.error === "radio_forbidden_host" && (await radioOf())?.stationId === station.id, `${srp4} ${internalErr.error ?? ""}`);
const [srn] = await api("PATCH", `/api/radio/stations/${station.id}`, { name: "Rauchtest-Radio 2" }, owner.token);
const renamed = await radioOf();
const [sru] = await api("PATCH", `/api/radio/stations/${station.id}`, { url: `${streamUrl}?neu=1` }, owner.token);
const [sre] = await api("PATCH", `/api/radio/stations/${station.id}`, {}, owner.token);
check("radio: a renamed station shows in the channel, a new address turns the radio off", srn === 200 && renamed?.name === "Rauchtest-Radio 2" && sru === 200 && sre === 400 && (await radioOf()) === null, `${srn} ${sru} ${sre}`);
await api("PUT", `/api/channels/${voiceCh.id}/radio`, { stationId: station.id }, owner.token);
// A typed address instead of a station: same permission, same rules for the address; shown under its host.
const [sru0] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: streamUrl }, B.token);
const [sru1] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: "ftp://example.org/x.mp3" }, owner.token);
const [sru2] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: "http://127.0.0.1:9/intern.m3u" }, owner.token);
const [sru3] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: streamUrl }, owner.token);
const typed = await radioOf();
check("radio: a typed address needs CONTROL_RADIO and is checked like a station's; stationId null, named by its host", sru0 === 403 && sru1 === 400 && sru2 === 502 && sru3 === 200
  && typed?.stationId === null && typed?.streamUrl === streamUrl && typed?.name === "streams.radiobob.de", `${sru0} ${sru1} ${sru2} ${sru3} ${typed?.name}`);
// A Twitch channel page: no audio stream, clients show Twitch's player; the server normalizes the address and asks nobody.
const [srt0] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: "https://twitch.tv/Squorli_Test/" }, owner.token);
const twitch = await radioOf();
const [srt1] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: "https://www.twitch.tv/videos/12345" }, owner.token);
const notTwitch = await radioOf();
check("radio: a twitch channel page becomes a twitch source, other twitch pages stay plain addresses", srt0 === 200 && twitch?.twitchChannel === "squorli_test" && twitch?.streamUrl === "https://www.twitch.tv/squorli_test"
  && twitch?.name === "twitch.tv/squorli_test" && srt1 === 200 && notTwitch?.twitchChannel === null, `${srt0} ${twitch?.twitchChannel} ${srt1}`);
// A YouTube video: shown with YouTube's player, played in step. The title comes from YouTube (oEmbed); offline the name falls back.
const YT_ID = "aqz-KE-bpKQ";
const [sry0] = await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: `https://youtu.be/${YT_ID}?t=1m30s` }, owner.token);
const youtube = await radioOf();
check("radio: a youtube address becomes a youtube source that starts playing for everyone at the address's offset", sry0 === 200 && youtube?.youtubeVideo === YT_ID && youtube?.twitchChannel === null
  && youtube?.streamUrl === `https://www.youtube.com/watch?v=${YT_ID}` && typeof youtube?.name === "string" && youtube.name.length > 0
  && youtube?.playback?.playing === true && youtube.playback.position === 90 && youtube.playback.rate === 1 && Math.abs(youtube.playback.at - Date.now()) < 60_000, `${sry0} ${youtube?.name} ${JSON.stringify(youtube?.playback)}`);
const [spb0] = await api("PUT", `/api/channels/${voiceCh.id}/radio/playback`, { playing: false, position: 10 }, B.token);
const [spb1] = await api("PUT", `/api/channels/${voiceCh.id}/radio/playback`, { playing: false, position: -5 }, owner.token);
const [spb2] = await api("PUT", `/api/channels/${voiceCh.id}/radio/playback`, { playing: false, position: 10, rate: 9 }, owner.token);
const [spb3, setPlayback] = await api("PUT", `/api/channels/${voiceCh.id}/radio/playback`, { playing: false, position: 123.5 }, owner.token);
const evPlayback = await wsB.waitFor((e) => e.type === "radio.playback" && e.channelId === voiceCh.id && e.playback.position === 123.5).catch(() => null);
const pausedVideo = await radioOf();
check("radio: play/pause/seek of a video needs CONTROL_RADIO, is stamped by the server, goes to everyone and stays on the channel", spb0 === 403 && spb1 === 400 && spb2 === 400 && spb3 === 200
  && evPlayback?.playback.playing === false && evPlayback.playback.rate === 1 && evPlayback.playback.at === setPlayback.playback.at
  && pausedVideo?.playback?.position === 123.5 && pausedVideo.playback.playing === false && pausedVideo.playback.at === setPlayback.playback.at, `${spb0} ${spb1} ${spb2} ${spb3}`);
await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: streamUrl }, owner.token);
const [spb4, noPlayback] = await api("PUT", `/api/channels/${voiceCh.id}/radio/playback`, { playing: true, position: 1 }, owner.token);
const [spb5] = await api("PUT", `/api/channels/${textCh.id}/radio/playback`, { playing: true, position: 1 }, owner.token);
check("radio: an audio source has no playback state to set", spb4 === 409 && noPlayback.error === "no_playback" && (await radioOf())?.playback === null && spb5 === 404, `${spb4} ${spb5}`);
await api("PUT", `/api/channels/${voiceCh.id}/radio`, { stationId: station.id }, owner.token);
const [srd0] = await api("DELETE", `/api/channels/${voiceCh.id}/radio`, undefined, B.token);
const stillOn = await radioOf();
const [srd1] = await api("DELETE", `/api/channels/${voiceCh.id}/radio`, undefined, owner.token);
check("radio: stop needs CONTROL_RADIO", srd0 === 403 && stillOn?.stationId === station.id && srd1 === 200 && (await radioOf()) === null, `${srd0} ${srd1}`);
await api("PUT", `/api/channels/${voiceCh.id}/radio`, { stationId: station.id }, owner.token);
const [srx0] = await api("DELETE", `/api/radio/stations/${station.id}`, undefined, B.token);
const [srx1] = await api("DELETE", `/api/radio/stations/${station.id}`, undefined, owner.token);
const [srx2] = await api("DELETE", `/api/radio/stations/${internalStation.id}`, undefined, owner.token);
const [, stRadioEnd] = await api("GET", "/api/state", undefined, owner.token);
check("radio: deleting a station turns it off where it plays", srx0 === 403 && srx1 === 200 && srx2 === 200 && stRadioEnd.channels.find((c) => c.id === voiceCh.id)?.radio === null
  && !stRadioEnd.radioStations.some((x) => x.id === station.id || x.id === internalStation.id), `${srx0} ${srx1} ${srx2}`);
// Idle stop: nobody in the channel -> the radio goes off (two minutes; the test server runs with RADIO_IDLE_STOP_MS, e.g. 2000).
const [sas0] = await api("PATCH", "/api/settings", { radioAutoStop: true }, B.token);
const [sas1] = await api("PATCH", "/api/settings", { radioAutoStop: true }, owner.token);
const [, stAutoStop] = await api("GET", "/api/state", undefined, owner.token);
check("radio: the idle stop is a server setting (MANAGE_SERVER), on by default", sas0 === 403 && sas1 === 200 && stAutoStop.settings.radioAutoStop === true && wsA.welcome.state.settings.radioAutoStop === true, `${sas0} ${sas1}`);
const IDLE_MS = Number(process.env.RADIO_IDLE_STOP_MS ?? 0);
if (IDLE_MS > 0 && IDLE_MS <= 10_000) {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  wsB.send({ type: "voice.join", channelId: voiceCh.id });
  await wsB.waitFor((e) => e.type === "voice.state" && e.channelId === voiceCh.id && e.members.some((m) => m.userId === B.userId));
  await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: streamUrl }, owner.token);
  await pause(IDLE_MS + 1500);
  const occupied = await radioOf();
  wsB.send({ type: "voice.leave" });
  const leftAt = Date.now();
  const evIdle = await wsA.waitFor((e) => e.type === "structure" && e.channels?.some((c) => c.id === voiceCh.id && c.radio === null) && Date.now() - leftAt >= IDLE_MS - 200, IDLE_MS + 4000).catch(() => null);
  const stoppedAfter = Date.now() - leftAt;
  // Turned off in the settings: an empty channel keeps its radio.
  await api("PATCH", "/api/settings", { radioAutoStop: false }, owner.token);
  await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: streamUrl }, owner.token);
  await pause(IDLE_MS + 1500);
  const keptOn = await radioOf();
  check("radio: goes off once the channel has been empty for the delay, not while somebody is inside, and not with the setting off", occupied !== null && !!evIdle && stoppedAfter >= IDLE_MS - 200 && (await radioOf()) !== null && keptOn !== null, `occupied=${occupied !== null} stopped after ${stoppedAfter} ms keptOn=${keptOn !== null}`);
  await api("DELETE", `/api/channels/${voiceCh.id}/radio`, undefined, owner.token);
  // The voice checks further down wait for their own voice.state: forget the ones from here.
  for (const w of [wsA, wsB]) w.events.splice(0, w.events.length, ...w.events.filter((e) => e.type !== "voice.state"));
} else console.log("skip radio idle stop timing (start the test server and this script with RADIO_IDLE_STOP_MS=2000 to check it)");
await api("PATCH", "/api/settings", { radioAutoStop: true }, owner.token);

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

// Read states (all devices of a member): B joined in this run and has never opened the channel, so the owner's messages count
const readOf = async (token) => { const [s, body] = await api("GET", "/api/read-state", undefined, token); return [s, body?.channels?.find((c) => c.channelId === textCh.id)]; };
const [srs1, rs1] = await readOf(B.token);
check("read state: unread since joining, own messages do not count", srs1 === 200 && rs1?.lastReadSeq === null && rs1.unread === true && rs1.mentions === 0 && rs1.latestSeq === page1.messages[1].seq, JSON.stringify(rs1));
const [, mention] = await api("POST", `/api/channels/${textCh.id}/messages`, { content: `Hallo <@${B.userId}>, schau mal` }, owner.token);
const [, rs2] = await readOf(B.token);
check("read state: mention counted", rs2?.unread === true && rs2.mentions === 1 && rs2.latestSeq === mention.seq, JSON.stringify(rs2));
const [sack, ack] = await api("POST", `/api/channels/${textCh.id}/read`, { seq: mention.seq }, B.token);
const evRead = await wsB.waitFor((e) => e.type === "read.update" && e.channelId === textCh.id).catch(() => null);
const [, rs3] = await readOf(B.token);
check("mark read: clears marks, tells my own connections only", sack === 200 && ack.lastReadSeq === mention.seq && evRead?.lastReadSeq === mention.seq
  && rs3?.unread === false && rs3.mentions === 0 && rs3.lastReadSeq === mention.seq && !wsA.events.some((e) => e.type === "read.update"), JSON.stringify(rs3));
const [, ackBack] = await api("POST", `/api/channels/${textCh.id}/read`, { seq: 0 }, B.token);
const [, ackFuture] = await api("POST", `/api/channels/${textCh.id}/read`, { seq: 2 ** 40 }, B.token);
check("mark read: never backwards, never beyond the newest message", ackBack.lastReadSeq === mention.seq && ackFuture.lastReadSeq === mention.seq, `${ackBack.lastReadSeq} ${ackFuture.lastReadSeq}`);
const [sackVoice] = await api("POST", `/api/channels/${voiceCh.id}/read`, { seq: 1 }, B.token);
const [sackBad] = await api("POST", `/api/channels/${textCh.id}/read`, { seq: -1 }, B.token);
const [sackAnon] = await api("GET", "/api/read-state");
check("mark read: text channels only, valid input, signed in", sackVoice === 404 && sackBad === 400 && sackAnon === 401, `${sackVoice} ${sackBad} ${sackAnon}`);
await api("POST", `/api/channels/${textCh.id}/messages`, { content: "danach" }, owner.token);
const [, rs4] = await readOf(B.token);
check("read state: a newer message marks the channel again", rs4?.unread === true && rs4.mentions === 0);
// No false alarms: a token inside code or behind a backslash is no mention, and an edited-away mention stops counting
const fence = "```";
await api("POST", `/api/channels/${textCh.id}/messages`, { content: `so sieht das aus: \`<@${B.userId}>\` und \\<@${B.userId}>\n${fence}\n<@${B.userId}>\n${fence}` }, owner.token);
const [, rs5] = await readOf(B.token);
const [, realMention] = await api("POST", `/api/channels/${textCh.id}/messages`, { content: `<@${B.userId}> doch` }, owner.token);
const [, rs6] = await readOf(B.token);
await api("PATCH", `/api/messages/${realMention.id}`, { content: "doch nicht" }, owner.token);
const [, rs7] = await readOf(B.token);
check("read state: tokens in code or escaped do not count, an edited-away mention neither", rs5?.mentions === 0 && rs6?.mentions === 1 && rs7?.mentions === 0 && rs7.unread === true, `${rs5?.mentions} ${rs6?.mentions} ${rs7?.mentions}`);

// Mutes (per member, all their devices): a channel and the whole server
const [smu1, mu1] = await api("PUT", `/api/channels/${textCh.id}/mute`, { muted: true }, B.token);
const evMute = await wsB.waitFor((e) => e.type === "mute.update" && e.channelIds?.includes(textCh.id)).catch(() => null);
const [, rsMuted] = await api("GET", "/api/read-state", undefined, B.token);
const [, rsOwner] = await api("GET", "/api/read-state", undefined, owner.token);
check("mute channel: stored for me only, told to my connections", smu1 === 200 && mu1.channelIds.includes(textCh.id) && mu1.serverMuted === false && !!evMute
  && rsMuted.channels.find((c) => c.channelId === textCh.id)?.muted === true && rsOwner.channels.find((c) => c.channelId === textCh.id)?.muted === false
  && !wsA.events.some((e) => e.type === "mute.update"));
const [smu2, mu2] = await api("PUT", "/api/me/mute", { muted: true }, B.token);
const [, rsServer] = await api("GET", "/api/read-state", undefined, B.token);
check("mute server", smu2 === 200 && mu2.serverMuted === true && mu2.channelIds.includes(textCh.id) && rsServer.serverMuted === true && rsOwner.serverMuted === false);
await api("PUT", `/api/channels/${textCh.id}/mute`, { muted: true }, B.token);   // twice = still once
const [, mu3] = await api("PUT", `/api/channels/${textCh.id}/mute`, { muted: false }, B.token);
const [, mu4] = await api("PUT", "/api/me/mute", { muted: false }, B.token);
check("unmute channel and server", mu3.channelIds.length === 0 && mu3.serverMuted === true && mu4.serverMuted === false);
const [smuVoice] = await api("PUT", `/api/channels/${voiceCh.id}/mute`, { muted: true }, B.token);
const [smuBad] = await api("PUT", "/api/me/mute", { muted: "ja" }, B.token);
const [smuAnon] = await api("PUT", "/api/me/mute", { muted: true });
check("mute: text channels only, valid input, signed in", smuVoice === 404 && smuBad === 400 && smuAnon === 401, `${smuVoice} ${smuBad} ${smuAnon}`);

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
// VIEW_VIDEO (guests lack it, "Mitglied" has it): the app server only reports it (`me`, roles); the senders' clients
// restrict their tracks at LiveKit. Voice itself stays allowed.
const [, stView] = await api("GET", "/api/state", undefined, B.token);
await api("PATCH", `/api/roles/${memberRole.id}`, { permissions: memberRole.permissions & ~P.VIEW_VIDEO }, owner.token);
const [, stNoView] = await api("GET", "/api/state", undefined, B.token);
const [sNoView] = await api("POST", "/api/rtc-token", { channelId: voiceCh.id }, B.token);
check("VIEW_VIDEO via Mitglied; without it: state reports it, voice token still issued", (stView.myPermissions & P.VIEW_VIDEO) !== 0 && (stNoView.myPermissions & P.VIEW_VIDEO) === 0 && sNoView === 200);
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

// ---------- AFK detection: status from the connections' activity reports, AFK channel (setting, silent token, no radio, move)
const [saf0] = await api("PATCH", "/api/settings", { afkChannelId: voiceCh2.id }, B.token);
const [saf1] = await api("PATCH", "/api/settings", { afkChannelId: textCh.id }, owner.token);
const [saf2] = await api("PATCH", "/api/settings", { afkMoveMinutes: 7 }, owner.token);
const [saf3] = await api("PATCH", "/api/settings", { afkChannelId: voiceCh2.id }, owner.token);
const [, stAfk] = await api("GET", "/api/state", undefined, owner.token);
check("afk channel: MANAGE_SERVER, a voice channel, one of the offered times; default 5 minutes", saf0 === 403 && saf1 === 400 && saf2 === 400 && saf3 === 200
  && stAfk.settings.afkChannelId === voiceCh2.id && stAfk.settings.afkMoveMinutes === 5 && wsA.welcome.state.settings.afkChannelId === null, `${saf0} ${saf1} ${saf2} ${saf3}`);
const [, afkTok] = await api("POST", "/api/rtc-token", { channelId: voiceCh2.id }, owner.token);
const [srAfk, radioAfk] = await api("PUT", `/api/channels/${voiceCh2.id}/radio`, { url: streamUrl }, owner.token);
check("afk channel: token without publish and subscribe grants, no radio", grantOf(afkTok.token).canPublish === false && grantOf(afkTok.token).canSubscribe === false && grantOf(afkTok.token).roomJoin === true
  && srAfk === 409 && radioAfk.error === "afk_channel", `${JSON.stringify(grantOf(afkTok.token))} ${srAfk}`);
const afkMoves = () => wsB.events.filter((e) => e.type === "voice.moved" && e.reason === "afk").length;
const nextAfkMove = (n, ms) => wsB.waitFor((e) => e.type === "voice.moved" && e.reason === "afk" && afkMoves() > n, ms).catch(() => null);
const afkStateOfB = (afk, from) => wsA.waitFor((e) => e.type === "structure" && e.members?.find((x) => x.userId === B.userId)?.afk === afk && wsA.events.indexOf(e) >= from).catch(() => null);
wsB.send({ type: "voice.join", channelId: voiceCh.id });
await wsB.waitFor((e) => e.type === "voice.state" && e.channelId === voiceCh.id && e.members.some((m) => m.userId === B.userId) && wsB.events.indexOf(e) >= wsB.events.length - 1).catch(() => null);
let mark = wsA.events.length;
wsB.send({ type: "activity", idle: true });
const evAfkOn = await afkStateOfB(true, mark);
const evAfkMove = await nextAfkMove(0, 7000);
check("idle on every connection -> member afk for everyone, moved to the afk channel", !!evAfkOn && evAfkMove?.channelId === voiceCh2.id, JSON.stringify(evAfkMove));
mark = wsA.events.length;
wsB.send({ type: "activity", idle: false });
const evAfkOff = await afkStateOfB(false, mark);
// Nobody is moved out of a channel that shows a video; once it ends, the next sweep moves them.
await api("PUT", `/api/channels/${voiceCh.id}/radio`, { url: "https://twitch.tv/squorli_test" }, owner.token);
wsB.send({ type: "activity", idle: true });
const evAfkVideo = await nextAfkMove(1, 1500);
await api("DELETE", `/api/channels/${voiceCh.id}/radio`, undefined, owner.token);
const evAfkAfterVideo = await nextAfkMove(1, 8000);
check("activity ends the absence; a channel showing a video keeps its absent members until the video ends", !!evAfkOff && evAfkVideo === null && evAfkAfterVideo?.channelId === voiceCh2.id, `back ${!!evAfkOff}, moved during the video ${!!evAfkVideo}, moved after it ${!!evAfkAfterVideo}`);
wsB.send({ type: "activity", idle: false });
wsB.send({ type: "voice.leave" });
await api("DELETE", `/api/channels/${voiceCh2.id}`, undefined, owner.token);
const [, stAfkGone] = await api("GET", "/api/state", undefined, owner.token);
check("deleting the afk channel clears the setting", stAfkGone.settings.afkChannelId === null, String(stAfkGone.settings.afkChannelId));

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
