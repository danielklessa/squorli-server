import { beforeEach, describe, expect, it } from "vitest";
import { forgetIdentity, loadOrCreateIdentity, loadServerAccounts, setSecretStore, storeServerAccount } from "./identity";

// Node has no localStorage: a small one per test.
function fakeLocalStorage() {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
  return m;
}
function fakeStore(works = true) {
  const m = new Map<string, string>();
  return { m, store: { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string | null) => { if (!works) return false; if (v === null) m.delete(k); else m.set(k, v); return true; } } };
}

describe("secrets in the platform's store (safeStorage)", () => {
  let ls: Map<string, string>;
  beforeEach(() => { ls = fakeLocalStorage(); setSecretStore(null); });

  it("moves an identity from localStorage into the store at the first read, and removes it there", async () => {
    ls.set("chat.identity.v1", JSON.stringify({ publicKey: "p", privateKey: "s" }));
    const { m, store } = fakeStore();
    setSecretStore(store);
    expect(await loadOrCreateIdentity()).toEqual({ publicKey: "p", privateKey: "s" });
    expect(m.get("chat.identity.v1")).toContain("\"p\"");
    expect(ls.has("chat.identity.v1")).toBe(false);
  });

  it("keeps localStorage when the store refuses to write, so nothing is lost", async () => {
    ls.set("chat.identity.v1", JSON.stringify({ publicKey: "p", privateKey: "s" }));
    const { store } = fakeStore(false);
    setSecretStore(store);
    expect((await loadOrCreateIdentity()).publicKey).toBe("p");
    expect(ls.has("chat.identity.v1")).toBe(true);
  });

  it("writes new secrets into the store only, and forgets them there", async () => {
    const { m, store } = fakeStore();
    setSecretStore(store);
    const id = await loadOrCreateIdentity();
    storeServerAccount("x.example", { ...id, localHandle: "bea", token: "t" });
    expect(m.has("chat.identity.v1") && m.has("chat.serverAccounts.v1")).toBe(true);
    expect(ls.size).toBe(0);
    expect(loadServerAccounts()["x.example"]?.token).toBe("t");
    forgetIdentity();
    expect(m.has("chat.identity.v1")).toBe(false);
  });

  it("without a store (browser) stays in localStorage", async () => {
    const id = await loadOrCreateIdentity();
    expect(JSON.parse(ls.get("chat.identity.v1")!)).toEqual(id);
  });
});
