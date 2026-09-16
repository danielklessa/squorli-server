import type { VoiceClient, VideoTile } from "./voice/voiceClient";
import { Icon } from "./Icon";
import { t } from "./i18n";

/** Local playback only: never changes the sender's stream or microphone. */
export function VideoAudioControls({ client, tile }: { client: VoiceClient; tile: VideoTile }) {
  const volume = client.getVideoAudioVolume(tile.id);
  if (volume === null || tile.isLocal) return null;
  const muted = volume === 0;
  const label = t(tile.source === "screen" ? "stage.screenVolume" : "stage.popupVolume");
  const muteLabel = t(muted ? "stage.unmutePlayback" : "stage.mutePlayback");
  return <div className="tile-volume video-audio-controls" role="group" aria-label={label}
    onClick={(event) => { event.stopPropagation(); void client.startAudio(); }}
    onDoubleClick={(event) => event.stopPropagation()}>
    <button className="icon" title={muteLabel} aria-label={muteLabel} aria-pressed={muted}
      onClick={() => client.toggleVideoAudioMuted(tile.id)}><Icon name={muted ? "volume-x" : "volume-2"} /></button>
    <input type="range" min={0} max={1} step={0.01} value={volume} title={label} aria-label={label}
      onChange={(event) => client.setVideoAudioVolume(tile.id, Number(event.target.value))} />
    <output>{Math.round(volume * 100)}%</output>
  </div>;
}
