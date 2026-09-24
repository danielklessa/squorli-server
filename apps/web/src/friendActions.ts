import { askConfirm } from "./dialogs";
import { t } from "./i18n";
import type { Store } from "./store";

/**
 * Removing and blocking a friend (docs/features/directory.md, 24 September 2026, user's wish: "Es fehlt generell die
 * Möglichkeit Freunde zu entfernen"). Both ask first and say what follows; the directory does the rest (`friends.remove`
 * ends the friendship for both, `friends.block` also keeps their requests out). The conversation stays at the directory
 * and shows again after a new friendship; it is not deleted.
 */
export function askRemoveFriend(store: Store, publicKey: string, name: string): void {
  void askConfirm({ title: t("friends.removeTitle", { name }), text: t("friends.removeText", { name }), confirmLabel: t("friends.remove"), danger: true })
    .then((ok) => { if (ok) store.removeFriend(publicKey); });
}

export function askBlockFriend(store: Store, publicKey: string, name: string): void {
  void askConfirm({ title: t("friends.blockTitle", { name }), text: t("friends.blockText", { name }), confirmLabel: t("friends.block"), danger: true })
    .then((ok) => { if (ok) store.blockFriend(publicKey); });
}
