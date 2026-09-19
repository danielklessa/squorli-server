export type LoginChoice = "account" | "device";

/** UI routing only; server-side account requirements remain authoritative. */
export function loginView(directory: boolean, hasAccount: boolean, requireAccount: boolean, choice: LoginChoice | null) {
  const accountRequired = directory && requireAccount;
  const deviceAllowed = !accountRequired || hasAccount;
  const mode = !directory ? "device"
    : choice === "device" && !deviceAllowed ? "account"
    : choice ?? (hasAccount ? "device" : "account");
  return { mode, accountRequired, deviceAllowed, showDevice: mode !== "account", showAccount: mode === "account" };
}
