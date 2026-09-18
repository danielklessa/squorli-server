import { Avatar } from "./Avatar";
import type { Channel } from "@squorli/protocol";
import { type MouseEvent } from "react";
import type { MenuAnchor } from "./ContextMenu";
import { useVoiceSettings } from "./voice/useVoiceSettings";
import type { VoiceClient, VoiceState } from "./voice/voiceClient";
import { Icon } from "./Icon";
import { t, tOr } from "./i18n";
import { usePushToTalk } from "./usePushToTalk";

type Props = {
  client: VoiceClient;
  voice: VoiceState;
  channel: Channel | null;
  /** Name of the voice connection's server when a different server is currently displayed (multi-server client); otherwise null. */
  serverName: string | null;
  displayName: string;
  onLeave: () => Promise<void>;
  /** Click on your own name: the mini profile, anchored at the name. */
  onOpenProfile: (anchor: MenuAnchor) => void;
  /** The gear: all user and profile settings (SettingsDialog). */
  onOpenSettings: () => void;
  /** The settings dialog is capturing a new push-to-talk key: that key press must not open the microphone. */
  pttSuspended: boolean;
  /** Show the stage (tiles) in the main area; null when it is already open. */
  onOpenStage: (() => void) | null;
  canStream: boolean;
  onToggleCamera: () => Promise<void>;
  /** Moved to the AFK channel for inactivity: explain it and offer the way back (`name` null = that channel is gone). */
  afkReturn: { name: string | null; onReturn: () => void } | null;
};

/** Bottom area of the sidebar: voice status with mute and leave, below it your own name (mini profile) and the gear (settings). */
export function VoiceDock({ client, voice, channel, serverName, displayName, onLeave, onOpenProfile, onOpenSettings, pttSuspended, onOpenStage, canStream, onToggleCamera, afkReturn }: Props) {
  const settings = useVoiceSettings();
  const joined = voice.status !== "disconnected";
  const openProfile = (event: MouseEvent<HTMLButtonElement>) => {
    // Upwards from the name row, flush with the dock's box and as wide as it, with a clear gap (user's wish); the menu clamps itself into the viewport.
    const row = (event.currentTarget.closest(".dock-row") ?? event.currentTarget).getBoundingClientRect();
    const dock = (event.currentTarget.closest(".dock") ?? event.currentTarget).getBoundingClientRect();
    onOpenProfile({ trigger: event.currentTarget, x: dock.left, y: row.top - 8, above: true, width: dock.width });
  };

  usePushToTalk(window, client, joined, pttSuspended);

  const levelPct = Math.min(100, Math.round(voice.level * 400));
  const thresholdPct = Math.min(100, Math.round(settings.vadThreshold * 400));

  return (
    <div className="dock">
      {joined && (
        <div className={`dock-voice ${voice.status === "connected" ? "connected" : "connecting"}`}>
          <div className="dock-status">
            <span className="dock-connection-icon"><Icon name={voice.status === "connected" ? "volume-2" : "phone"} /></span>
            <div className="dock-connection-copy">
              <strong className="dock-connection-label" role="status">{voice.status === "connected" ? t("dock.connected") : tOr(`conn.${voice.status}`, voice.status)}</strong>
              <span className="dock-channel" title={serverName ? `${serverName} / ${channel?.name ?? "…"}` : channel?.name}>{channel?.name ?? "…"}</span>
              {serverName && <span className="dock-server" title={serverName}>{serverName}</span>}
            </div>
          </div>
          {onOpenStage && <button className="dock-stage" title={t("dock.stageHint")} onClick={onOpenStage}><Icon name="monitor" /><span>{t("dock.stage")}</span><Icon name="chevron-down" rotate={270} /></button>}
          <div className="dock-notices">
            {!voice.canPlayback && <button className="small warn" title={t("dock.unblockAudioHint")} onClick={() => client.startAudio()}>{t("dock.unblockAudio")}</button>}
            {voice.status === "connected" && voice.audioContext !== "running" && voice.audioContext !== "none" && <button className="small warn" title={t("dock.unblockMicHint")} onClick={() => client.prepareAudio()}>{t("dock.unblockMic")}</button>}
          </div>
          {voice.error && <p className="error small">{voice.error}</p>}
          {voice.afkRoom && (
            <div className="warn-box small dock-afk" role="status">
              <span><Icon name="moon" /> {afkReturn ? t("dock.afkMoved") : t("dock.afkChannel")}</span>
              {afkReturn?.name && <button className="small" onClick={afkReturn.onReturn}>{t("dock.afkReturn", { name: afkReturn.name })}</button>}
            </div>
          )}
          {voice.notice && <p className="warn-box small">{voice.notice} <button className="icon" title={t("common.dismiss")} onClick={() => client.setNotice(null)}><Icon name="x" /></button></p>}
          <div className={`dock-input ${voice.micMuted ? "is-muted" : ""}`}>
            <span className="dock-input-label"><Icon name={voice.micMuted ? "mic-off" : "mic"} />{voice.micMuted ? t("voice.micMuted") : t("dock.micLevel")}</span>
            <div className="meter small-meter" aria-hidden="true">
              <div className="meter-fill" style={{ width: `${voice.micMuted ? 0 : levelPct}%` }} />
              {settings.mode === "vad" && !voice.micMuted && <div className="meter-threshold" style={{ left: `${thresholdPct}%` }} />}
            </div>
          </div>
          {/* quick actions of the voice connection: its own area above the name row */}
          <div className="dock-row dock-controls">
            <button aria-label={t("voice.mute")} aria-pressed={voice.micMuted} className={`icon ${voice.micMuted ? "danger" : ""}`} disabled={voice.afkRoom} title={voice.afkRoom ? t("dock.afkChannel") : voice.micMuted ? (voice.deafened ? t("voice.unmuteAll") : t("voice.unmute")) : t("voice.mute")} onClick={() => client.setMuted(!voice.micMuted)}><Icon name={voice.micMuted ? "mic-off" : "mic"} /></button>
            <button aria-label={t("voice.deafen")} aria-pressed={voice.deafened} className={`icon ${voice.deafened ? "danger" : ""}`} disabled={voice.afkRoom} title={voice.afkRoom ? t("dock.afkChannel") : voice.deafened ? t("voice.undeafen") : t("voice.deafen")} onClick={() => client.setDeafened(!voice.deafened)}><Icon name={voice.deafened ? "headphone-off" : "headphones"} /></button>
            {canStream && !voice.afkRoom && <button aria-label={t("voice.cameraOnBtn")} aria-pressed={voice.cameraOn} className={`icon ${voice.cameraOn ? "on" : ""}`} title={voice.cameraOn ? t("voice.cameraOff") : t("voice.cameraOnBtn")} onClick={() => { void onToggleCamera(); }}><Icon name={voice.cameraOn ? "video" : "video-off"} /></button>}
            <button aria-label={t("voice.leave")} className="icon hangup" title={t("voice.leave")} onClick={() => onLeave()}><Icon name="phone" rotate={135} /></button>
          </div>
        </div>
      )}
      {!joined && voice.error && <p className="error small">{voice.error}</p>}
      <div className="dock-row">
        <button className="dock-name" aria-haspopup="menu" onClick={openProfile} title={t("dock.profile")}><Avatar name={displayName} /><span className="dock-identity"><strong>{displayName}</strong><small>{t("profile.tab.profile")}</small></span></button>
        <button className="icon" title={t("dock.settings")} onClick={onOpenSettings}><Icon name="settings" /></button>
      </div>

    </div>
  );
}

