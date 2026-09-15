import { useState } from "react";
import { t } from "./i18n";

type Props = {
  name: string;
  /** Reserved for a future, validated profile-image URL supplied by the API. */
  src?: string | null;
  size?: "small" | "medium" | "large";
  online?: boolean;
};

/** Names are rendered beside avatars; only presence needs an accessible label. */
export function Avatar({ name, src, size = "medium", online }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const initials = (words.length > 1
    ? [Array.from(words[0]!)[0], Array.from(words[words.length - 1]!)[0]].join("")
    : Array.from(words[0] ?? "?").slice(0, 2).join("")).toLocaleUpperCase();
  return (
    <span className={`user-avatar user-avatar--${size}`}>
      {src && src !== failedSrc
        ? <img key={src} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
        : <span aria-hidden="true">{initials}</span>}
      {online !== undefined && <span className={`avatar-presence ${online ? "on" : "off"}`} role="img" aria-label={t(online ? "members.online" : "members.offline")} />}
    </span>
  );
}
