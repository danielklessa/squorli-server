import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { describe, expect, it } from "vitest";
import { DirectoryClientEvent, DirectoryServerEvent, DmSend, bytesToHex, deriveDmKey, dmPublicKeyOf, openDm, sealDm } from "./index";

const seedA = "0a".repeat(32); const seedB = "0b".repeat(32); const seedC = "0c".repeat(32);
const pubOf = (seed: string) => bytesToHex(ed25519.getPublicKey(Buffer.from(seed, "hex")));
const [pubA, pubB, pubC] = [pubOf(seedA), pubOf(seedB), pubOf(seedC)];
const ID = "6f1c2a4e-1b2c-4d3e-8f90-123456789abc";

describe("dm (M7): E2E-Verschluesselung", () => {
  it("both sides derive the same pair key and can read each other", async () => {
    const kA = await deriveDmKey(seedA, pubA, pubB);
    const kB = await deriveDmKey(seedB, pubB, pubA);
    const sealed = await sealDm(kA, pubA, pubB, ID, { text: "Hallo Bö" });
    expect(await openDm(kB, { ...sealed, from: pubA, to: pubB, id: ID })).toEqual({ text: "Hallo Bö" });
    // The sender reads their own message (history on all devices).
    expect(await openDm(kA, { ...sealed, from: pubA, to: pubB, id: ID })).toEqual({ text: "Hallo Bö" });
  });
  it("rejects a third party and any swapped field (AAD)", async () => {
    const kA = await deriveDmKey(seedA, pubA, pubB);
    const kC = await deriveDmKey(seedC, pubC, pubA);
    const sealed = await sealDm(kA, pubA, pubB, ID, { text: "geheim" });
    await expect(openDm(kC, { ...sealed, from: pubA, to: pubB, id: ID })).rejects.toBeDefined();
    const kB = await deriveDmKey(seedB, pubB, pubA);
    await expect(openDm(kB, { ...sealed, from: pubB, to: pubA, id: ID })).rejects.toBeDefined();
    await expect(openDm(kB, { ...sealed, from: pubA, to: pubB, id: ID.replace("6f", "7f") })).rejects.toBeDefined();
  });
  it("uses a fresh iv per message and the schema accepts the result", async () => {
    const kA = await deriveDmKey(seedA, pubA, pubB);
    const a = await sealDm(kA, pubA, pubB, ID, { text: "x" });
    const b = await sealDm(kA, pubA, pubB, ID, { text: "x" });
    expect(a.iv).not.toBe(b.iv);
    expect(DmSend.safeParse({ type: "dm.send", to: pubB, id: ID, ...a, sentAt: new Date().toISOString() }).success).toBe(true);
  });
  it("converts secret and public key consistently (X25519 pub of the converted seed = converted Ed25519 pub)", () => {
    const xPriv = ed25519.utils.toMontgomerySecret(Buffer.from(seedA, "hex"));
    expect(bytesToHex(x25519.getPublicKey(xPriv))).toBe(dmPublicKeyOf(pubA));
  });
  it("event unions parse friend actions and reject unknown types", () => {
    expect(DirectoryClientEvent.safeParse({ type: "friends.accept", publicKey: pubA }).success).toBe(true);
    expect(DirectoryClientEvent.safeParse({ type: "friends.nope", publicKey: pubA }).success).toBe(false);
    expect(DirectoryServerEvent.safeParse({ type: "friends.update", publicKey: pubA, friend: null }).success).toBe(true);
  });
});
