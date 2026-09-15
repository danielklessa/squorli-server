import { describe, expect, it } from "vitest";
import { BackupUploadRequest, createBackup, deriveBackupKeys, openBackup } from "./index";

// Few iterations to keep the test fast; the derivation is the same as with BACKUP_ITERATIONS.
const SEED = "0f".repeat(32);

describe("backup (M6b)", () => {
  it("round-trips the seed with the right password", async () => {
    const b = await createBackup("geheim-genug", SEED, 1000);
    const keys = await deriveBackupKeys("geheim-genug", b.params.salt, b.params.iterations);
    expect(keys.authKey).toBe(b.authKey);
    expect(await openBackup(keys, b.params.iv, b.ciphertext)).toBe(SEED);
  });
  it("rejects a wrong password (different auth key, decrypt fails)", async () => {
    const b = await createBackup("geheim-genug", SEED, 1000);
    const wrong = await deriveBackupKeys("geheim-genuG", b.params.salt, b.params.iterations);
    expect(wrong.authKey).not.toBe(b.authKey);
    await expect(openBackup(wrong, b.params.iv, b.ciphertext)).rejects.toBeDefined();
  });
  it("uses fresh salt and iv per backup", async () => {
    const a = await createBackup("pw-pw-pw-pw", SEED, 1000);
    const b = await createBackup("pw-pw-pw-pw", SEED, 1000);
    expect(a.params.salt).not.toBe(b.params.salt);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it("upload request schema accepts the created backup", async () => {
    const b = await createBackup("pw-pw-pw-pw", SEED, 100_000);
    const req = { publicKey: "ab".repeat(32), challengeId: "6f1c2a4e-1b2c-4d3e-8f90-123456789abc", signature: "cd".repeat(64), ciphertext: b.ciphertext, params: b.params, authKey: b.authKey };
    expect(BackupUploadRequest.safeParse(req).success).toBe(true);
    expect(BackupUploadRequest.safeParse({ ...req, params: { ...b.params, iterations: 10 } }).success).toBe(false);
  });
});
