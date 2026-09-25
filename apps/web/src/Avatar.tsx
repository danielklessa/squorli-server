import { useState } from "react";
import { t } from "./i18n";

type Props = {
  name: string;
  /**
   * Avatar of the directory account: `Member.avatarUrl` / `Me.avatarUrl` from the chat server, or `directoryAvatarUrl` for friends.
   * Without one, and when the image cannot be loaded, the initials show.
   */
  src?: string | null | undefined;
  size?: "small" | "medium" | "large";
  online?: boolean;
  /** Online but absent (AFK detection): an amber dot instead of the green one. */
  afk?: boolean;
};

/** Names are rendered beside avatars; only presence needs an accessible label. */
export function Avatar({ name, src, size = "medium", online, afk }: Props) {
  const presence = !online ? "off" : afk ? "afk" : "on";
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // A name that is a handle ("@anna", "~anna") starts with its letters, not with the prefix.
  const words = name.trim().replace(/^[@~]+/, "").split(/\s+/u).filter(Boolean);
  const initials = (words.length > 1
    ? [Array.from(words[0]!)[0], Array.from(words[words.length - 1]!)[0]].join("")
    : Array.from(words[0] ?? "?").slice(0, 2).join("")).toLocaleUpperCase();
  return (
    <span className={`user-avatar user-avatar--${size}`}>
      {src && src !== failedSrc
        ? <img key={src} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
        : <span aria-hidden="true">{initials}</span>}
      {online !== undefined && <span className={`avatar-presence ${presence}`} role="img" aria-label={t(presence === "on" ? "members.online" : presence === "afk" ? "members.afk" : "members.offline")} title={presence === "afk" ? t("members.afk") : undefined} />}
    </span>
  );
}
