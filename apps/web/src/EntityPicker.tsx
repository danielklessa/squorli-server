import type { Member, Role } from "@squorli/protocol";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { ContextMenu, type MenuAnchor } from "./ContextMenu";
import { entryKey, suggestEntities, type PickerEntry } from "./pickerEntries";
import { Icon } from "./Icon";
import { t } from "./i18n";

/**
 * "Add a role or member" of the channel dialog (docs/features/channel-permissions.md): a menu anchored at the button,
 * a search field and the matches (pickerEntries.ts ranks them). Rendered as a ContextMenu so it inherits the portal, the
 * Escape, the click beside it and the edge correction; the field keeps the menu's arrow keys for itself, like the mini
 * profile's field does.
 */
export function EntityPicker({ anchor, roles, members, exclude, onPick, onClose }: {
  anchor: MenuAnchor; roles: Role[]; members: Member[]; exclude: ReadonlySet<string>; onPick: (e: PickerEntry) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = suggestEntities(roles, members, query, { exclude });
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setCursor(0); }, [query]);
  const pick = (e: PickerEntry) => { onPick(e); onClose(); };
  return (
    <ContextMenu anchor={anchor} label={t("chan.addEntry")} onClose={onClose}>
      <div className="entity-picker" role="presentation">
        <input ref={input} data-menu-item type="search" value={query} placeholder={t("picker.placeholder")} aria-label={t("picker.placeholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setCursor((c) => Math.min(c + 1, list.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); const hit = list[cursor]; if (hit) pick(hit); }
            else if (e.key === "Home" || e.key === "End") e.stopPropagation();
          }} />
        <ul role="listbox" aria-label={t("chan.addEntry")}>
          {list.length === 0 && <li className="muted small">{t("picker.empty")}</li>}
          {list.map((e, i) => (
            <li key={entryKey(e)} role="option" aria-selected={i === cursor} className={i === cursor ? "active" : ""} onMouseEnter={() => setCursor(i)} onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick(e)}>
              {e.kind === "role"
                ? <><span className="role-dot" style={e.role.color ? { background: e.role.color } : undefined} /><span className="entity-name">{e.role.name}</span><span className="muted small">{t("chan.role")}</span></>
                : <><Avatar name={e.member.displayName} src={e.member.avatarUrl} size="small" /><span className="entity-name">{e.member.displayName}</span>{e.member.handle && <span className="muted small">@{e.member.handle}</span>}</>}
              <Icon name="plus" />
            </li>
          ))}
        </ul>
      </div>
    </ContextMenu>
  );
}
