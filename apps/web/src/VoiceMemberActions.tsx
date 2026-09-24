import { CHANNEL_BLOCK_MINUTES, Permission, hasPermission, type Channel, type ChannelBlock, type Member, type VoiceMember } from "@squorli/protocol";
import { useEffect, useState } from "react";
import type { ServerApi } from "./api";
import { blockErrorText, moveErrorText } from "./apiErrorText";
import { ContextSubmenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { blockMinutes, voteKickChannel } from "./voteKick";

/**
 * What a member's context menu offers about voice channels (docs/features/channel-blocks.md): the channel they sit in,
 * move, remove (with the block submenu), stop camera/screen, block streaming, their channel blocks to lift, the vote kick.
 * One component for the member list and the voice members in the sidebar (user's wish, 24 September 2026: the same
 * voice entries in both menus). Only what my rights allow is drawn; the server checks again.
 */
export function VoiceMemberActions({ api, member, myUserId, permsIn, voice, channels, voteKickAllowed, onVoteKick, streaming, onClose, onError }: {
  api: ServerApi;
  member: Member;
  myUserId: string;
  /** My permissions in a channel (null = server-wide); an overwrite may give the moderation rights in one channel only. */
  permsIn: (channelId: string | null) => number;
  voice: Record<string, VoiceMember[]>;
  channels: Channel[];
  voteKickAllowed: Record<string, boolean>;
  onVoteKick: (userId: string, channelId: string) => void;
  /** Camera or screen on right now; default = what the member's client reported to the server. */
  streaming?: boolean;
  onClose: () => void;
  onError: (text: string | null) => void;
}) {
  const m = member;
  const isMe = m.userId === myUserId;
  const inVoice = Object.keys(voice).find((cid) => (voice[cid] ?? []).some((x) => x.userId === m.userId)) ?? null;
  const seat = inVoice ? voice[inVoice]?.find((x) => x.userId === m.userId) : undefined;
  const live = streaming ?? (!!seat && (seat.cameraOn || seat.screenOn));
  const perms = permsIn(inVoice);
  const canMove = hasPermission(perms, Permission.MOVE_MEMBERS);
  const canModerate = hasPermission(perms, Permission.MODERATE_VOICE);
  const canMoveAnywhere = canMove || hasPermission(permsIn(null), Permission.MOVE_MEMBERS);
  const voiceChannels = channels.filter((c) => c.kind === "voice");

  // Channel blocks: fetched when the menu opens, so it can offer to lift them (the server lists only what I may lift).
  const [blocks, setBlocks] = useState<ChannelBlock[]>([]);
  const loadBlocks = () => { api.channelBlocks().then(setBlocks, () => setBlocks([])); };
  useEffect(() => { if (!isMe && canMoveAnywhere) loadBlocks(); }, [m.userId, canMoveAnywhere]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, explain: (e: unknown) => string = String) => {
    onError(null);
    onClose();
    try { await fn(); } catch (e) { onError(explain(e)); }
  };
  /** Lifting a block keeps the menu open, so several can go in a row. */
  const liftBlock = (b: ChannelBlock) => {
    onError(null);
    setBlocks((all) => all.filter((x) => x !== b));
    api.liftChannelBlock(b.channelId, b.userId).then(loadBlocks, (e: unknown) => { onError(blockErrorText(e)); loadBlocks(); });
  };

  const mine = isMe ? [] : blocks.filter((b) => b.userId === m.userId);
  const voteKickIn = voteKickChannel({ voice, voteKickAllowed, myUserId, targetId: m.userId });
  return (
    <>
      {!isMe && (canModerate || canMove) && !m.isOwner && (
        <div className="stack mod-voice">
          <span className="muted small">{t("members.voiceChannel")}: {inVoice ? channels.find((c) => c.id === inVoice)?.name ?? "?" : t("members.notConnected")}</span>
          {inVoice && canMove && voiceChannels.some((c) => c.id !== inVoice) && (
            <ContextSubmenu label={t("members.moveTo")}>
              {voiceChannels.filter((c) => c.id !== inVoice).map((c) => <button role="menuitem" key={c.id} onClick={() => run(() => api.moveMember(m.userId, c.id), moveErrorText)}><Icon name="volume-2" /> {c.name}</button>)}
            </ContextSubmenu>
          )}
          {/* Its own entry (user's wish, 24 September 2026): a click removes, the submenu removes and blocks the channel. */}
          {inVoice && canMove && (
            <ContextSubmenu label={t("members.removeFromVoice")} className="danger" onActivate={() => run(() => api.moveMember(m.userId, null), moveErrorText)}>
              <span className="muted small menu-note" role="presentation">{t("members.removeAndBlock")}</span>
              {/* First: only remove, the same as a click on the entry (user's wish, 24 September 2026). */}
              <button role="menuitem" onClick={() => run(() => api.moveMember(m.userId, null), moveErrorText)}><Icon name="log-out" /> {t("members.blockNone")}</button>
              {CHANNEL_BLOCK_MINUTES.map((minutes) => <button role="menuitem" key={minutes} onClick={() => run(() => api.setChannelBlock(inVoice, m.userId, minutes), blockErrorText)}><Icon name="clock" /> {t("members.blockMinutes", { minutes })}</button>)}
              <button role="menuitem" className="danger" onClick={() => run(() => api.setChannelBlock(inVoice, m.userId, null), blockErrorText)}><Icon name="ban" /> {t("members.blockPermanent")}</button>
            </ContextSubmenu>
          )}
          {/* Greyed while neither camera nor screen is on (user's wish, 24 September 2026): there is nothing to end. */}
          {inVoice && canModerate && <button role="menuitem" className="secondary small" disabled={!live} title={live ? undefined : t("members.stopStreamsNone")}
            onClick={() => run(() => api.stopMemberStreams(m.userId, { camera: true, screen: true }))}>{t("members.stopStreams")}</button>}
          {canModerate && <button role="menuitem" className={`${m.streamBlocked ? "" : "danger"} small`} onClick={() => run(() => api.setStreamBlocked(m.userId, !m.streamBlocked))}>
            {m.streamBlocked ? t("members.allowStreams") : t("members.blockStreams")}
          </button>}
        </div>
      )}
      {mine.length > 0 && (
        <div className="stack">
          <span className="muted small menu-section-title">{t("members.channelBlocks")}</span>
          {mine.map((b) => (
            <button key={b.channelId} role="menuitem" className="secondary small block-row" onClick={() => liftBlock(b)}>
              <span><Icon name="lock-open" /> {t("members.liftBlock", { channel: channels.find((c) => c.id === b.channelId)?.name ?? "?" })}</span>
              <small className="muted">{b.until ? t("members.blockLeft", { minutes: blockMinutes(b.until, Date.now()) }) : t("members.blockForever")}{b.source === "votekick" ? ` · ${t("members.blockVoteKick")}` : ""}</small>
            </button>
          ))}
        </div>
      )}
      {/* Vote kick: only where we both sit and the server allows it right now (it checks again). */}
      {voteKickIn && (
        <div className="row">
          <button role="menuitem" className="secondary small" onClick={() => { onClose(); onVoteKick(m.userId, voteKickIn); }}><Icon name="gavel" /> {t("votekick.menu")}</button>
        </div>
      )}
    </>
  );
}
