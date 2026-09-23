import type { OverwriteState } from "./channelPerms";
import { Icon } from "./Icon";
import { t } from "./i18n";

/**
 * The three-way switch of one permission in the channel dialog (docs/features/channel-permissions.md): deny, inherit,
 * allow. A radio group, not a cycling button: one tab stop, the arrow keys move by themselves, a screen reader says
 * "Erlauben, ausgewählt, 3 von 3". `inherited` colours the frame of the inherit segment after what a neutral entry
 * resolves to, so the reader sees the effect without leaving the row.
 */
const STATES: { value: OverwriteState; icon: string; key: "permState.deny" | "permState.neutral" | "permState.allow" }[] = [
  { value: "deny", icon: "x", key: "permState.deny" },
  { value: "neutral", icon: "minus", key: "permState.neutral" },
  { value: "allow", icon: "check", key: "permState.allow" },
];

export function TriState({ name, label, value, onChange, disabled = false, inherited = null }: {
  name: string; label: string; value: OverwriteState; onChange: (v: OverwriteState) => void; disabled?: boolean; inherited?: "allow" | "deny" | null;
}) {
  return (
    <fieldset className={`tri-state is-${value}${inherited ? ` inherits-${inherited}` : ""}`} disabled={disabled}>
      <legend className="sr-only">{label}</legend>
      {STATES.map((s) => (
        <label key={s.value} className={`tri-${s.value}${value === s.value ? " active" : ""}`} title={t(s.key)}>
          <input type="radio" name={name} value={s.value} checked={value === s.value} onChange={() => onChange(s.value)} aria-label={t(s.key)} />
          <Icon name={s.icon} />
        </label>
      ))}
    </fieldset>
  );
}
