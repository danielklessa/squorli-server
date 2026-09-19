import { describe, expect, it } from "vitest";
import { loginView } from "./loginView";

describe("server login choices", () => {
  it("offers account sign-in first for an unregistered browser", () => {
    expect(loginView(true, false, false, null)).toMatchObject({ showAccount: true, showDevice: false });
  });
  it("switches to local access without showing account sign-in or registration", () => {
    expect(loginView(true, false, false, "device")).toMatchObject({ showAccount: false, showDevice: true });
  });
  it("does not offer a local bypass on account-only servers", () => {
    expect(loginView(true, false, true, "device")).toMatchObject({ deviceAllowed: false, showAccount: true, showDevice: false });
  });
  it("lets an existing verified account continue on account-only servers", () => {
    expect(loginView(true, true, true, null)).toMatchObject({ deviceAllowed: true, mode: "device" });
    expect(loginView(true, true, true, "account").mode).toBe("account");
  });
  it("uses local access when there is no directory", () => {
    expect(loginView(false, false, false, "account")).toMatchObject({ mode: "device" });
  });
});
