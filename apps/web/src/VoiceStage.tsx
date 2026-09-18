import { FullscreenButton, TrackVideo } from "./VideoWindows";
import { VideoAudioControls } from "./VideoAudioControls";
import { Avatar } from "./Avatar";
import { Permission, displayNameOf, hasPermission, type Channel, type Member, type RadioStation } from "@squorli/protocol";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ContextMenu, type MenuAnchor } from "./ContextMenu";
import { UserVolumeControl } from "./UserVolumeControl";
import { RadioControl } from "./RadioControl";
import { EmbedSlot } from "./EmbedPlayer";
import type { ServerApi } from "./api";
import type { RadioPlayer } from "./voice/radioPlayer";
import { VoiceClient, explainScreenAudio, isChromium, type VideoTile, type VoiceParticipant, type VoiceState } from "./voice/voiceClient";
import { Icon } from "./Icon";
import { t } from "./i18n";
import { platform } from "./platform";
import { useVoiceSettings } from "./voice/useVoiceSettings";

type Props = {
  client: VoiceClient;
  voice: VoiceState;
  channel: Channel;
  members: Member[];
  myPermissions: number;
  /** Web radio: the voice server's API, the local player and the server's stations (undefined = a server without radio). */
  api: ServerApi;
  radio: RadioPlayer;
  radioStations: RadioStation[] | undefined;
  /** What the channel's station is playing right now, null = unknown. */
  radioTitle: string | null;
  /** The channel's radio is a Twitch or YouTube source and the user has not turned the radio off: its player gets a tile (the source's key, else null). */
  playerTile: string | null;
  /** The player is open in a window of its own: the tile says so and offers to bring it back. */
  playerPopped: boolean;
  onRestorePlayer: () => void;
  /** Camera on/off; asks when there are several cameras (App.tsx). */
  onToggleCamera: () => Promise<void>;
  onToggleBlur: () => Promise<void>;
  onLeave: () => Promise<void>;
  /** `opener`: the window the click happened in (a browser lets only that one open a window). */
  onPopout: (tile: VideoTile, opener?: Window) => void;
  poppedIds: Set<string>;
  onRestore: (id: string) => void;
  /** This stage is the one in a window of its own (StageWindow.tsx); the button in the head then brings it back. */
  detached: boolean;
  /** Move the whole stage into a window of its own, or back. May throw with a text for the user (window refused). */
  onToggleWindow: () => void;
};

type Layout = "grid" | "focus";
type Item = { key: string; participant: VoiceParticipant; tile: VideoTile | null; kind: "camera" | "screen" } | { key: string; participant: null; tile: null; kind: "player" };

/**
 * Stage of a voice channel (M3): one tile per participant (camera or avatar) plus one per screen share.
 * The default is the tile view; the tile size is computed so that all of them fit into the visible area
 * (no scrolling). Clicking a tile enlarges it (focus), clicking the large tile goes back.
 * "Speaker" follows the active speaker or the newest screen share without pinning.
 * Receive quality follows the tile size (adaptiveStream in the voice core); here the <video> only has to have the right size.
 */
export function VoiceStage({ client, voice, channel, members, myPermissions, api, radio, radioStations, radioTitle, playerTile, playerPopped, onRestorePlayer, onToggleCamera, onToggleBlur, onLeave, onPopout, poppedIds, onRestore, detached, onToggleWindow }: Props) {
  // Names from the server's member list (arrives via WS immediately on every rename), not from the LiveKit token,
  // which is only created on joining. Unknown identities (bots, "external") keep the LiveKit name.
  const participants = voice.participants.map((p) => {
    const m = members.find((x) => x.userId === p.identity);
    return m ? { ...p, name: displayNameOf(m) } : p;
  });
  const [layout, setLayout] = useState<Layout>("grid"); // always start with tiles
  const [pinned, setPinned] = useState<string | null>(null);
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const canStream = hasPermission(myPermissions, Permission.STREAM_VIDEO) && !voice.afkRoom; // nothing is sent in the AFK channel
  // Without VIEW_VIDEO others' camera and screen never arrive; say so while somebody is sharing, instead of just showing avatars.
  const hiddenStreams = !hasPermission(myPermissions, Permission.VIEW_VIDEO) && participants.some((p) => !p.isLocal && (p.cameraOn || p.screenOn));

  // Others win over yourself; whether you are featured at all while only you speak is the user's choice (settings > view).
  const { featureSelfInSpeakerView } = useVoiceSettings();
  useEffect(() => {
    const s = participants.find((p) => p.speaking && !p.isLocal) ?? (featureSelfInSpeakerView ? participants.find((p) => p.speaking) : undefined);
    if (s) setLastSpeaker(s.identity);
  }, [voice.participants, featureSelfInSpeakerView]);

  const items: Item[] = [];
  for (const p of participants) {
    const cam = voice.tiles.find((t) => t.identity === p.identity && t.source === "camera") ?? null;
    items.push({ key: `${p.identity}:camera`, participant: p, tile: cam, kind: "camera" });
  }
  // A Twitch or YouTube source of the radio is shown like a screen share (user's decision); real shares come after it, so the newest of them wins the focus.
  if (playerTile) items.push({ key: `player:${playerTile}`, participant: null, tile: null, kind: "player" });
  for (const t of voice.tiles.filter((t) => t.source === "screen")) {
    const participant = participants.find((p) => p.identity === t.identity);
    if (participant) items.push({ key: t.id, participant, tile: t, kind: "screen" });
  }
  // A new screen share automatically moves into focus as long as nothing is pinned.
  const screens = items.filter((i) => i.kind === "screen" || i.kind === "player");
  const lastScreen = screens[screens.length - 1];
  // With "feature myself" off your own camera tile only becomes the large one by pinning it, or when nobody else is there.
  const mayFeature = (i: Item) => featureSelfInSpeakerView || !i.participant?.isLocal;
  const focusKey = (pinned && items.some((i) => i.key === pinned) ? pinned : null)
    ?? lastScreen?.key
    ?? (lastSpeaker ? items.find((i) => i.kind === "camera" && i.participant.identity === lastSpeaker && mayFeature(i))?.key : undefined)
    ?? items.find((i) => i.tile && mayFeature(i))?.key
    ?? items.find(mayFeature)?.key
    ?? items.find((i) => i.tile)?.key
    ?? items[0]?.key
    ?? null;
  const focus = items.find((i) => i.key === focusKey) ?? null;
  const rest = items.filter((i) => i.key !== focusKey);
  const screenHint = explainScreenAudio(voice, platform.kind === "desktop" ? { audioPossible: platform.os === "windows" } : undefined);
  const grid = useFittedGrid(items.length);

  // A share's audio plays only for who selected that share (clicked it large) or popped it out (VideoWindows.tsx); a share
  // that merely moved into focus by itself stays silent. Leaving the stage ends the listening.
  const screenIds = voice.tiles.filter((tile) => tile.source === "screen" && !tile.isLocal).map((tile) => tile.id).join(" ");
  useEffect(() => {
    const ids = screenIds ? screenIds.split(" ") : [];
    for (const id of ids) client.setScreenAudioListening(id, "stage", layout === "focus" && pinned === id);
    return () => { for (const id of ids) client.setScreenAudioListening(id, "stage", false); };
  }, [client, screenIds, layout, pinned]);

  // Click a tile: show it large. Click the large tile: back to the tiles.
  const focusOn = (key: string) => { setPinned(key); setLayout("focus"); };
  const unfocus = () => { setPinned(null); setLayout("grid"); };

  // Right-click a tile of another member: how loud to play them back. Bots have no member entry and get no menu.
  const [menu, setMenu] = useState<({ identity: string } & MenuAnchor) | null>(null);
  const menuMember = menu ? members.find((m) => m.userId === menu.identity) ?? null : null;
  const openMenu = (item: Item, event: ReactMouseEvent<HTMLElement>) => {
    if (!item.participant || item.participant.isLocal || !members.some((m) => m.userId === item.participant.identity)) return;
    if (event.currentTarget.ownerDocument.fullscreenElement) return; // the menu lives in the body, behind a fullscreen tile
    event.preventDefault();
    setMenu({ identity: item.participant.identity, trigger: event.currentTarget, x: event.clientX, y: event.clientY });
  };

  return (
    <section className="stage">
      <header className="chat-head">
        <span className="channel-icon"><Icon name="volume-2" /></span><strong>{channel.name}</strong>
        <span className="muted small">· {t("stage.participants", { n: voice.participants.length })}{voice.audioProfile && ` · Opus ${voice.audioProfile.bitrate} kbit/s ${voice.audioProfile.stereo ? t("stage.stereo") : t("stage.mono")}`}</span>
        <span className="spacer" />
        {radioStations && !voice.afkRoom && <RadioControl api={api} player={radio} channel={channel} stations={radioStations} nowPlaying={radioTitle} canControl={hasPermission(myPermissions, Permission.CONTROL_RADIO)} />}
        <div className="seg">
          <button className={layout === "focus" ? "active" : ""} title={t("stage.speakerHint")} onClick={() => setLayout("focus")}>{t("stage.speaker")}</button>
          <button className={layout === "grid" ? "active" : ""} title={t("stage.gridHint")} onClick={() => setLayout("grid")}>{t("stage.grid")}</button>
        </div>
        <button className="icon" title={t(detached ? "stage.restoreStage" : "stage.popoutStage")} aria-label={t(detached ? "stage.restoreStage" : "stage.popoutStage")}
          onClick={() => { try { onToggleWindow(); } catch (error) { client.setNotice(error instanceof Error ? error.message : t("stage.popupFailed")); } }}><Icon name={detached ? "undo-2" : "external-link"} /></button>
      </header>

      {voice.error && <p className="error small stage-hint">{voice.error}</p>}
      {voice.afkRoom && <p className="warn-box small stage-hint"><Icon name="moon" /> {t("dock.afkChannel")}</p>}
      {voice.notice && <p className="warn-box small stage-hint">{voice.notice} <button className="icon" title={t("common.dismiss")} onClick={() => client.setNotice(null)}><Icon name="x" /></button></p>}
      {screenHint && <p className="warn-box small stage-hint">{screenHint}</p>}
      {hiddenStreams && <p className="warn-box small stage-hint">{t("stage.noViewPermission")}</p>}
      {!voice.canPlayback && <p className="warn-box small stage-hint">{t("stage.audioBlocked")} <button className="small" onClick={() => client.startAudio()}>{t("dock.unblockAudio")}</button></p>}

      {items.length === 0 ? (
        <div className="stage-empty muted">{t("stage.empty")}</div>
      ) : layout === "grid" || !focus ? (
        <div className="stage-grid" ref={grid.ref}>
          <div className="stage-grid-inner" style={{ gridTemplateColumns: `repeat(${grid.cols}, ${grid.tileWidth}px)` }}>
            {items.map((i) => i.kind === "player" ? <PlayerTile key={i.key} popped={playerPopped} elsewhere={detached} onRestore={onRestorePlayer} />
              : <Tile key={i.key} item={i} client={client} onPopout={onPopout} poppedIds={poppedIds} onRestore={onRestore} onMenu={openMenu} pinned={false} onClick={() => focusOn(i.key)} />)}
          </div>
        </div>
      ) : (
        <div className="stage-focus">
          <div className="stage-main">{focus.kind === "player" ? <PlayerTile big popped={playerPopped} elsewhere={detached} onRestore={onRestorePlayer} />
            : <Tile item={focus} client={client} onPopout={onPopout} poppedIds={poppedIds} onRestore={onRestore} onMenu={openMenu} big pinned={pinned === focus.key} onClick={unfocus} />}</div>
          {rest.length > 0 && (
            <div className="stage-strip">
              {rest.map((i) => i.kind === "player" ? <PlayerTile key={i.key} popped={playerPopped} elsewhere={detached} onRestore={onRestorePlayer} />
                : <Tile key={i.key} item={i} client={client} onPopout={onPopout} poppedIds={poppedIds} onRestore={onRestore} onMenu={openMenu} pinned={false} onClick={() => focusOn(i.key)} />)}
            </div>
          )}
        </div>
      )}

      {menu && menuMember && (
        <ContextMenu anchor={menu} label={displayNameOf(menuMember)} onClose={() => setMenu(null)}>
          <div className="context-identity" role="presentation"><Avatar name={displayNameOf(menuMember)} /><strong>{displayNameOf(menuMember)}</strong></div>
          <UserVolumeControl client={client} publicKey={menuMember.publicKey} />
        </ContextMenu>
      )}

      <footer className="stage-bar">
        <button className={`bar-btn ${voice.micMuted ? "off" : ""}`} disabled={voice.afkRoom} title={voice.afkRoom ? t("dock.afkChannel") : voice.micMuted ? (voice.deafened ? t("voice.unmuteAll") : t("voice.unmute")) : t("voice.mute")} onClick={() => client.setMuted(!voice.micMuted)}><Icon name={voice.micMuted ? "mic-off" : "mic"} /></button>
        <button className={`bar-btn ${voice.deafened ? "off" : ""}`} disabled={voice.afkRoom} title={voice.afkRoom ? t("dock.afkChannel") : voice.deafened ? t("voice.undeafen") : t("voice.deafen")} onClick={() => client.setDeafened(!voice.deafened)}><Icon name={voice.deafened ? "headphone-off" : "headphones"} /></button>
        <button className={`bar-btn ${voice.cameraOn ? "on" : ""}`} disabled={!canStream} title={voice.afkRoom ? t("dock.afkChannel") : canStream ? (voice.cameraOn ? t("voice.cameraOff") : t("voice.cameraOnBtn")) : t("stage.noStreamPermission")}
          onClick={() => { void onToggleCamera(); }}><Icon name={voice.cameraOn ? "video" : "video-off"} /></button>
        {voice.cameraOn && VoiceClient.supportsBlur() && (
          <button className={`bar-btn ${voice.cameraBlur > 0 ? "on" : ""}`} title={voice.cameraBlur > 0 ? t("stage.unblur") : t("stage.blur")} onClick={() => { void onToggleBlur(); }}><Icon name="wand-sparkles" /></button>
        )}
        <button className={`bar-btn ${voice.screenOn ? "on" : ""}`} disabled={!canStream} title={voice.afkRoom ? t("dock.afkChannel") : canStream ? (voice.screenOn ? t("stage.stopShare") : isChromium() ? t("stage.shareWithAudio") : t("stage.shareNoAudio")) : t("stage.noStreamPermission")}
          onClick={() => client.setScreenShareEnabled(!voice.screenOn)}><Icon name={voice.screenOn ? "screen-share-off" : "screen-share"} /></button>
        <button className="bar-btn leave" title={t("voice.leave")} onClick={() => onLeave()}><Icon name="phone" rotate={135} /></button>
      </footer>
    </section>
  );
}

/** Computes columns and tile width (16:9) so n tiles fit into the container without scrolling. */
function useFittedGrid(n: number) {
  // Callback ref instead of useRef: the container is only mounted once participants are there, and is recreated
  // when switching views. Only this way is it measured every time (otherwise the tiles would stay at the fallback size).
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => setEl(node), []);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    // The observer of the window the stage lives in (it can be one of its own): another window's is not reliable.
    const ro = new (el.ownerDocument.defaultView ?? window).ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const gap = 8, pad = 12;
  const W = Math.max(0, size.w - 2 * pad), H = Math.max(0, size.h - 2 * pad);
  // Without a measured height (first frame) divide by width only, so the result is never 0 px.
  let best = { cols: Math.max(1, Math.ceil(Math.sqrt(n))), tileWidth: Math.max(160, Math.floor(W / Math.max(1, Math.ceil(Math.sqrt(n))))) };
  if (n > 0 && W > 0 && H > 0) {
    let bestArea = 0;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const byWidth = (W - gap * (cols - 1)) / cols;
      const byHeight = ((H - gap * (rows - 1)) / rows) * (16 / 9);
      const tileWidth = Math.max(1, Math.floor(Math.min(byWidth, byHeight)));
      if (tileWidth * tileWidth > bestArea) { bestArea = tileWidth * tileWidth; best = { cols, tileWidth }; }
    }
  }
  return { ref, ...best };
}

/**
 * Twitch's or YouTube's player as a tile. The tile only reserves the room: the player (EmbedPlayer, mounted in App) lays itself over it
 * completely and brings its own controls; ours is the pop-out button it shows on hover. Enlarging works through the
 * "Sprecher" view, where this tile counts like a screen share.
 * `elsewhere`: this stage is in a window of its own. The player is one iframe of the main window and moving it would
 * reload it, so it stays there (floating, or in its own window) and the tile only says so.
 */
function PlayerTile({ big, popped, elsewhere, onRestore }: { big?: boolean; popped: boolean; elsewhere: boolean; onRestore: () => void }) {
  return (
    <div className={`tile screen embed ${big ? "big" : ""}`}>
      {elsewhere ? <div className="tile-popped"><Icon name="radio" /><span>{t(popped ? "stage.poppedOut" : "stage.playerInMain")}</span></div>
        : popped ? <div className="tile-popped"><Icon name="external-link" /><span>{t("stage.poppedOut")}</span><button className="secondary small" onClick={onRestore}>{t("stage.restoreVideo")}</button></div> : <EmbedSlot />}
    </div>
  );
}

function Tile({ item, client, big, pinned, onClick, onPopout, poppedIds, onRestore, onMenu }: { item: Extract<Item, { participant: VoiceParticipant }>; client: VoiceClient; big?: boolean; pinned: boolean; onClick: () => void; onPopout: (tile: VideoTile, opener?: Window) => void; poppedIds: Set<string>; onRestore: (id: string) => void; onMenu: (item: Item, event: ReactMouseEvent<HTMLElement>) => void }) {
  const { participant: p, tile } = item;
  const ref = useRef<HTMLDivElement>(null);
  const target = useCallback(() => ref.current, []);
  const [error, setError] = useState("");
  const hasAudioControls = item.kind === "screen" && !!tile && !tile.isLocal && client.getVideoAudioVolume(tile.id) !== null;
  const popped = !!tile && poppedIds.has(tile.id);
  // A share shown in fullscreen counts as selected, also from a small tile: its audio plays (voiceClient.setScreenAudioListening).
  const listenId = item.kind === "screen" && tile && !tile.isLocal ? tile.id : null;
  useEffect(() => {
    const doc = ref.current?.ownerDocument;
    if (!listenId || !doc) return;
    const update = () => client.setScreenAudioListening(listenId, "fullscreen", doc.fullscreenElement === ref.current);
    update(); doc.addEventListener("fullscreenchange", update);
    return () => { doc.removeEventListener("fullscreenchange", update); client.setScreenAudioListening(listenId, "fullscreen", false); };
  }, [client, listenId]);
  const cls = ["tile", item.kind, hasAudioControls ? "has-volume" : "", p.speaking && item.kind === "camera" ? "speaking" : "", big ? "big" : "", tile && !popped ? "" : "avatar"].join(" ");
  return (
    <div ref={ref} className={cls} onClick={() => { if (!ref.current?.ownerDocument.fullscreenElement) onClick(); }} onContextMenu={(event) => onMenu(item, event)} title={big ? t("stage.backToGrid") : t("stage.enlarge")}>
      {popped ? <div className="tile-popped"><Icon name="external-link" /><span>{t("stage.poppedOut")}</span><button className="secondary small" onClick={(event) => { event.stopPropagation(); onRestore(tile!.id); }}>{t("stage.restoreVideo")}</button></div> : tile ? <TrackVideo tile={tile} /> : <Avatar name={p.name} size="large" />}
      {tile && !popped && <div className="tile-window-actions" onClick={(event) => event.stopPropagation()}>
        <button className="icon" title={t("stage.popout")} aria-label={t("stage.popout")} onClick={() => { setError(""); try { onPopout(tile, ref.current?.ownerDocument.defaultView ?? undefined); } catch (error) { setError(error instanceof Error ? error.message : t("stage.popupFailed")); } }}><Icon name="external-link" /></button>
        <FullscreenButton target={target} onError={setError} />
      </div>}
      {error && <div className="tile-window-error" role="alert" onClick={(event) => event.stopPropagation()}>{error}<button className="icon" title={t("common.dismiss")} onClick={() => setError("")}><Icon name="x" /></button></div>}
      <div className="tile-label">
        <span>{item.kind === "screen" && <><Icon name="monitor" /> </>}{p.isLocal ? `${p.name} ${t("members.you")}` : p.name}</span>
        {item.kind === "camera" && p.micMuted && <> <Icon name="mic-off" title={t("voice.micMuted")} /></>}
        {item.kind === "camera" && p.deafened && <> <Icon name="headphone-off" title={t("voice.deafened")} /></>}
        {item.kind === "screen" && tile?.hasAudio && <> {tile.isLocal || client.isScreenAudioListening(tile.id) ? <Icon name="volume-2" title={t("stage.withAudio")} /> : <Icon name="volume-x" title={t("stage.audioOnSelect")} />}</>}
        {pinned && <> <Icon name="pin" title={t("stage.pinned")} /></>}
      </div>
      {hasAudioControls && tile && <VideoAudioControls client={client} tile={tile} />}
    </div>
  );
}
