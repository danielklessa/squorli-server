import { Permission, discordTemplateCodeOf, hasPermission, permissionNames, type ImportPlan, type ServerState } from "@squorli/protocol";
import { useState } from "react";
import { ApiError, type ServerApi } from "./api";
import { Icon } from "./Icon";
import { t } from "./i18n";

type RunFn = (fn: () => Promise<unknown>) => Promise<void>;

/**
 * Admin area > Import (docs/features/import.md): take a Discord server's structure over from one of its templates. The
 * admin pastes the template link, the server answers with a plan (what would be created, what exists already, what
 * Discord has that Squorli has not), the admin unticks what they do not want and imports. Nothing is replaced: what
 * exists by name is skipped (user's decision, 22 September 2026).
 */
export function ImportTab({ api, server, run }: { api: ServerApi; server: ServerState; run: RunFn }) {
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set()); // keys the admin unticked
  const [afk, setAfk] = useState(true);
  const [done, setDone] = useState<{ categories: number; channels: number; roles: number; afkChannelSet: boolean } | null>(null);
  const code = discordTemplateCodeOf(input);
  const canSetAfk = hasPermission(server.myPermissions, Permission.MANAGE_SERVER);

  const failed = (e: unknown) => {
    if (e instanceof ApiError && (e.code === "bad_code" || e.code === "unknown_template" || e.code === "discord_rate_limited" || e.code === "discord_unavailable" || e.code === "cannot_grant")) {
      setError(t(`admin.import.err.${e.code}`));
      return;
    }
    setError(String(e));
  };

  const load = async () => {
    if (!code) return;
    setBusy(true); setError(null); setDone(null);
    try { setPlan(await api.discordImportPreview(input.trim())); setOff(new Set()); setAfk(true); } catch (e) { failed(e); } finally { setBusy(false); }
  };

  const toggle = (key: string, on: boolean) => setOff((prev) => { const next = new Set(prev); if (on) next.delete(key); else next.add(key); return next; });
  const on = (key: string) => !off.has(key);

  if (!plan) {
    return (
      <div className="stack">
        <p className="muted small">{t("admin.import.intro")}</p>
        <ol className="muted small import-steps">
          <li>{t("admin.import.step1")}</li>
          <li>{t("admin.import.step2")}</li>
          <li>{t("admin.import.step3")}</li>
        </ol>
        <form className="row" onSubmit={(e) => { e.preventDefault(); void load(); }}>
          <input className="grow" value={input} maxLength={512} inputMode="url" placeholder="https://discord.new/…" aria-label={t("admin.import.link")} onChange={(e) => setInput(e.target.value)} />
          <button type="submit" disabled={!code || busy}>{busy ? t("admin.import.loading") : t("admin.import.load")}</button>
        </form>
        {input.trim() && !code && <span className="error small">{t("admin.import.err.bad_code")}</span>}
        {error && <p className="error">{error}</p>}
        {done && <p className="import-done">{t("admin.import.done", { categories: String(done.categories), channels: String(done.channels), roles: String(done.roles) })}{done.afkChannelSet ? ` ${t("admin.import.doneAfk")}` : ""}</p>}
      </div>
    );
  }

  const catByKey = new Map(plan.categories.map((c) => [c.key, c]));
  const groups: { key: string | null; name: string; existingId: string | null }[] = [
    { key: null, name: t("admin.import.noCategory"), existingId: null },
    ...plan.categories.map((c) => ({ key: c.key, name: c.name, existingId: c.existingId })),
  ];
  const channelsOf = (key: string | null) => plan.channels.filter((c) => c.categoryKey === key);
  const selectedCategories = plan.categories.filter((c) => c.existingId === null && on(c.key)).map((c) => c.key);
  const selectedChannels = plan.channels.filter((c) => !c.exists && on(c.key) && (c.categoryKey === null || catByKey.get(c.categoryKey)?.existingId !== null || on(c.categoryKey))).map((c) => c.key);
  const selectedRoles = plan.roles.filter((r) => !r.exists && r.blocked === null && on(r.key)).map((r) => r.key);
  const total = selectedCategories.length + selectedChannels.length + selectedRoles.length;
  const afkChannel = plan.afkChannelKey ? plan.channels.find((c) => c.key === plan.afkChannelKey) ?? null : null;
  const afkOffered = afkChannel !== null && canSetAfk && selectedChannels.includes(afkChannel.key);

  const apply = () => run(async () => {
    setBusy(true); setError(null);
    try {
      const result = await api.discordImport({ code: plan.source.code, categories: selectedCategories, channels: selectedChannels, roles: selectedRoles, afkChannel: afkOffered && afk });
      setDone(result); setPlan(null); setInput("");
    } catch (e) { failed(e); } finally { setBusy(false); }
  });

  return (
    <div className="stack">
      <div className="row">
        <strong>{t("admin.import.source", { name: plan.source.name })}</strong>
        <span className="spacer" />
        <button className="secondary" onClick={() => { setPlan(null); setError(null); }}>{t("admin.import.other")}</button>
      </div>
      {plan.source.description && <p className="muted small">{plan.source.description}</p>}
      <p className="muted small">{t("admin.import.planHint")}</p>

      <h3>{t("admin.import.channels")}</h3>
      {groups.map((g) => {
        const items = channelsOf(g.key);
        if (!items.length && g.key === null) return null;
        const catOn = g.key === null || g.existingId !== null || on(g.key);
        return (
          <fieldset className="perm-group import-group" key={g.key ?? "top"}>
            <legend>
              {g.key === null ? g.name : g.existingId !== null ? (
                <span className="check"><Icon name="folder" /> {g.name} <span className="muted">({t("admin.import.existingCategory")})</span></span>
              ) : (
                <label className="check"><input type="checkbox" checked={on(g.key)} onChange={(e) => toggle(g.key!, e.target.checked)} /><Icon name="folder" /> {g.name}</label>
              )}
            </legend>
            {items.length === 0 && <span className="muted small">{t("admin.import.emptyCategory")}</span>}
            {items.map((c) => (
              <label className={`check import-item${c.exists ? " muted" : ""}`} key={c.key}>
                <input type="checkbox" disabled={c.exists || !catOn} checked={!c.exists && catOn && on(c.key)} onChange={(e) => toggle(c.key, e.target.checked)} />
                <Icon name={c.kind === "voice" ? "volume-2" : "hash"} />
                <span className="import-name">{c.name}</span>
                <span className="muted small import-meta">
                  {c.exists ? t("admin.import.exists") : [
                    c.kind === "voice" ? `${c.audioBitrate} kbit/s` : null,
                    c.topic ? c.topic : null,
                    c.overwrites ? t("admin.import.overwrites", { n: String(c.overwrites) }) : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}

      <h3>{t("admin.import.roles")}</h3>
      {plan.roles.length === 0 && <span className="muted small">{t("admin.import.noRoles")}</span>}
      {plan.roles.map((r) => {
        const usable = !r.exists && r.blocked === null;
        const names = permissionNames(r.permissions);
        return (
          <label className={`check import-item${usable ? "" : " muted"}`} key={r.key}>
            <input type="checkbox" disabled={!usable} checked={usable && on(r.key)} onChange={(e) => toggle(r.key, e.target.checked)} />
            <span className="import-role-swatch" style={{ background: r.color ?? "var(--muted)" }} aria-hidden />
            <span className="import-name">{r.name}</span>
            <span className="muted small import-meta">
              {r.exists ? t("admin.import.exists") : r.blocked ? t("admin.import.cannotGrant")
                : names.length ? names.map((n) => t(`perm.${n}`)).join(", ") : t("admin.import.noPermissions")}
            </span>
          </label>
        );
      })}

      {afkChannel && canSetAfk && (
        <label className="check">
          <input type="checkbox" disabled={!afkOffered} checked={afkOffered && afk} onChange={(e) => setAfk(e.target.checked)} />
          {t("admin.import.afk", { name: afkChannel.name })}
        </label>
      )}

      {plan.dropped.length > 0 && (
        <>
          <h3>{t("admin.import.dropped")}</h3>
          <ul className="muted small import-dropped">
            {plan.dropped.map((d, i) => <li key={i}>{d.name}: {t(`admin.import.dropped.${d.reason}`)}</li>)}
          </ul>
        </>
      )}
      <p className="muted small">{t("admin.import.permissionsNote")}</p>

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button disabled={total === 0 || busy} onClick={() => void apply()}>{busy ? t("admin.import.applying") : t("admin.import.apply", { n: String(total) })}</button>
      </div>
    </div>
  );
}
