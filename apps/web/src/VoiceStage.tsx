import { Permission, displayNameOf, hasPermission, type Channel, type Member } from "@squorli/protocol";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { VoiceClient, explainScreenAudio, isChromium, type VideoTile, type VoiceParticipant, type VoiceState } from "./voice/voiceClient";
import { Icon } from "./Icon";

type Props = {
  client: VoiceClient;
  voice: VoiceState;
  channel: Channel;
  members: Member[];
  myPermissions: number;
  /** Kamera an/aus; fragt bei mehreren Kameras nach (App.tsx). */
  onToggleCamera: () => Promise<void>;
  onToggleBlur: () => Promise<void>;
  onLeave: () => Promise<void>;
};

type Layout = "grid" | "focus";
type Item = { key: string; participant: VoiceParticipant; tile: VideoTile | null; kind: "camera" | "screen" };

/**
 * Buehne eines Sprachkanals (M3): eine Kachel je Teilnehmer (Kamera oder Avatar) plus eine je Bildschirmfreigabe.
 * Standard ist die Kachelansicht; die Kachelgroesse wird so berechnet, dass alle in den sichtbaren Bereich passen
 * (kein Scrollen). Klick auf eine Kachel vergroessert sie (Fokus), Klick auf die grosse Kachel fuehrt zurueck.
 * "Sprecher" folgt ohne Anheften dem aktiven Sprecher bzw. der neuesten Bildschirmfreigabe.
 * Die Empfangsqualitaet folgt der Kachelgroesse (adaptiveStream im Sprach-Kern), hier muss nur das <video> passend gross sein.
 */
export function VoiceStage({ client, voice, channel, members, myPermissions, onToggleCamera, onToggleBlur, onLeave }: Props) {
  // Namen aus der Mitgliederliste des Servers (kommt bei jeder Umbenennung sofort per WS), nicht aus dem LiveKit-Token,
  // das nur beim Beitritt entsteht. Unbekannte Identitaeten (Bots, "extern") behalten den LiveKit-Namen.
  const participants = voice.participants.map((p) => {
    const m = members.find((x) => x.userId === p.identity);
    return m ? { ...p, name: displayNameOf(m) } : p;
  });
  const [layout, setLayout] = useState<Layout>("grid"); // immer mit Kacheln starten
  const [pinned, setPinned] = useState<string | null>(null);
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const canStream = hasPermission(myPermissions, Permission.STREAM_VIDEO);

  useEffect(() => {
    const s = participants.find((p) => p.speaking && !p.isLocal) ?? participants.find((p) => p.speaking);
    if (s) setLastSpeaker(s.identity);
  }, [voice.participants]);

  const items: Item[] = [];
  for (const p of participants) {
    const cam = voice.tiles.find((t) => t.identity === p.identity && t.source === "camera") ?? null;
    items.push({ key: `${p.identity}:camera`, participant: p, tile: cam, kind: "camera" });
  }
  for (const t of voice.tiles.filter((t) => t.source === "screen")) {
    const participant = participants.find((p) => p.identity === t.identity);
    if (participant) items.push({ key: t.id, participant, tile: t, kind: "screen" });
  }
  // Neue Bildschirmfreigabe rueckt automatisch in den Fokus, solange nichts angeheftet ist.
  const screens = items.filter((i) => i.kind === "screen");
  const lastScreen = screens[screens.length - 1];
  const focusKey = (pinned && items.some((i) => i.key === pinned) ? pinned : null)
    ?? lastScreen?.key
    ?? (lastSpeaker ? items.find((i) => i.kind === "camera" && i.participant.identity === lastSpeaker)?.key : undefined)
    ?? items.find((i) => i.tile)?.key
    ?? items[0]?.key
    ?? null;
  const focus = items.find((i) => i.key === focusKey) ?? null;
  const rest = items.filter((i) => i.key !== focusKey);
  const screenHint = explainScreenAudio(voice);
  const grid = useFittedGrid(items.length);

  // Klick auf eine Kachel: gross zeigen. Klick auf die grosse Kachel: zurueck zu den Kacheln.
  const focusOn = (key: string) => { setPinned(key); setLayout("focus"); };
  const unfocus = () => { setPinned(null); setLayout("grid"); };

  return (
    <section className="stage">
      <header className="chat-head">
        <span className="channel-icon"><Icon name="volume-2" /></span><strong>{channel.name}</strong>
        <span className="muted small">· {voice.participants.length} Teilnehmer{voice.audioProfile && ` · Opus ${voice.audioProfile.bitrate} kbit/s ${voice.audioProfile.stereo ? "Stereo" : "Mono"}`}</span>
        <span className="spacer" />
        <div className="seg">
          <button className={layout === "focus" ? "active" : ""} title="Sprecher gross, andere klein" onClick={() => setLayout("focus")}>Sprecher</button>
          <button className={layout === "grid" ? "active" : ""} title="Alle gleich gross" onClick={() => setLayout("grid")}>Kacheln</button>
        </div>
      </header>

      {voice.error && <p className="error small stage-hint">{voice.error}</p>}
      {voice.notice && <p className="warn-box small stage-hint">{voice.notice} <button className="icon" title="Ausblenden" onClick={() => client.setNotice(null)}><Icon name="x" /></button></p>}
      {screenHint && <p className="warn-box small stage-hint">{screenHint}</p>}
      {!voice.canPlayback && <p className="warn-box small stage-hint">Ton ist blockiert, bis du einmal klickst. <button className="small" onClick={() => client.startAudio()}>Ton freigeben</button></p>}

      {items.length === 0 ? (
        <div className="stage-empty muted">Noch niemand im Kanal.</div>
      ) : layout === "grid" || !focus ? (
        <div className="stage-grid" ref={grid.ref}>
          <div className="stage-grid-inner" style={{ gridTemplateColumns: `repeat(${grid.cols}, ${grid.tileWidth}px)` }}>
            {items.map((i) => <Tile key={i.key} item={i} client={client} pinned={false} onClick={() => focusOn(i.key)} />)}
          </div>
        </div>
      ) : (
        <div className="stage-focus">
          <div className="stage-main"><Tile item={focus} client={client} big pinned={pinned === focus.key} onClick={unfocus} /></div>
          {rest.length > 0 && (
            <div className="stage-strip">
              {rest.map((i) => <Tile key={i.key} item={i} client={client} pinned={false} onClick={() => focusOn(i.key)} />)}
            </div>
          )}
        </div>
      )}

      <footer className="stage-bar">
        <button className={`bar-btn ${voice.micMuted ? "off" : ""}`} title={voice.micMuted ? (voice.deafened ? "Ton und Mikrofon wieder an" : "Mikrofon wieder an") : "Mikrofon stummschalten"} onClick={() => client.setMuted(!voice.micMuted)}><Icon name={voice.micMuted ? "mic-off" : "mic"} /></button>
        <button className={`bar-btn ${voice.deafened ? "off" : ""}`} title={voice.deafened ? "Ton wieder an" : "Ton aus (schaltet auch das Mikrofon stumm)"} onClick={() => client.setDeafened(!voice.deafened)}><Icon name={voice.deafened ? "headphone-off" : "headphones"} /></button>
        <button className={`bar-btn ${voice.cameraOn ? "on" : ""}`} disabled={!canStream} title={canStream ? (voice.cameraOn ? "Kamera aus" : "Kamera an") : "Kein Recht: Kamera und Bildschirm teilen"}
          onClick={() => { void onToggleCamera(); }}><Icon name={voice.cameraOn ? "video" : "video-off"} /></button>
        {voice.cameraOn && VoiceClient.supportsBlur() && (
          <button className={`bar-btn ${voice.cameraBlur > 0 ? "on" : ""}`} title={voice.cameraBlur > 0 ? "Hintergrund wieder scharf" : "Hintergrund unscharf machen"} onClick={() => { void onToggleBlur(); }}><Icon name="wand-sparkles" /></button>
        )}
        <button className={`bar-btn ${voice.screenOn ? "on" : ""}`} disabled={!canStream} title={canStream ? (voice.screenOn ? "Bildschirmfreigabe beenden" : isChromium() ? "Bildschirm teilen (mit Ton)" : "Bildschirm teilen (ohne Ton in diesem Browser)") : "Kein Recht: Kamera und Bildschirm teilen"}
          onClick={() => client.setScreenShareEnabled(!voice.screenOn)}><Icon name={voice.screenOn ? "screen-share-off" : "screen-share"} /></button>
        <button className="bar-btn leave" title="Sprachkanal verlassen (auflegen)" onClick={() => onLeave()}><Icon name="phone" rotate={135} /></button>
      </footer>
    </section>
  );
}

/** Berechnet Spalten und Kachelbreite (16:9), damit n Kacheln ohne Scrollen in den Container passen. */
function useFittedGrid(n: number) {
  // Callback-Ref statt useRef: der Container wird erst eingehaengt, wenn Teilnehmer da sind, und beim Umschalten
  // der Ansicht neu erzeugt. Nur so wird jedes Mal gemessen (sonst blieben die Kacheln auf der Notgroesse).
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => setEl(node), []);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  const gap = 8, pad = 12;
  const W = Math.max(0, size.w - 2 * pad), H = Math.max(0, size.h - 2 * pad);
  // Ohne gemessene Hoehe (erster Frame) nur nach Breite aufteilen, damit nie 0 px herauskommen.
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

function Tile({ item, client, big, pinned, onClick }: { item: Item; client: VoiceClient; big?: boolean; pinned: boolean; onClick: () => void }) {
  const { participant: p, tile } = item;
  const [volume, setVolume] = useState(1);
  const cls = ["tile", item.kind, p.speaking && item.kind === "camera" ? "speaking" : "", big ? "big" : "", tile ? "" : "avatar"].join(" ");
  return (
    <div className={cls} onClick={onClick} title={big ? "Klick: zurück zu den Kacheln" : "Klick: groß anzeigen"}>
      {tile ? <Video tile={tile} /> : <div className="avatar-circle">{initials(p.name)}</div>}
      <div className="tile-label">
        <span>{item.kind === "screen" && <><Icon name="monitor" /> </>}{p.isLocal ? `${p.name} (du)` : p.name}</span>
        {item.kind === "camera" && p.micMuted && <> <Icon name="mic-off" title="Mikrofon stumm" /></>}
        {item.kind === "camera" && p.deafened && <> <Icon name="headphone-off" title="Ton aus" /></>}
        {item.kind === "screen" && tile?.hasAudio && <> <Icon name="volume-2" title="mit Ton" /></>}
        {pinned && <> <Icon name="pin" title="angeheftet" /></>}
      </div>
      {item.kind === "screen" && tile?.audio && (
        <input className="tile-volume" type="range" min={0} max={1} step={0.05} value={volume} title="Lautstärke des Bildschirm-Tons"
          onClick={(e) => e.stopPropagation()} onChange={(e) => { const v = Number(e.target.value); setVolume(v); client.setScreenAudioVolume(p.identity, v); }} />
      )}
    </div>
  );
}

/** Haengt den LiveKit-Track an ein <video>; adaptiveStream misst dessen Groesse fuer die Simulcast-Stufe. */
function Video({ tile }: { tile: VideoTile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    tile.track.attach(el);
    return () => { tile.track.detach(el); };
  }, [tile.track]);
  return <video ref={ref} className={tile.isLocal && tile.source === "camera" ? "mirror" : ""} autoPlay playsInline muted />;
}

const initials = (name: string) => name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
