import { useEffect, useRef, useState } from "react";
import type { VoiceClient } from "./voice/voiceClient";
import { deriveVideoStats, fmtBitrate, type InboundVideoSample, type VideoStatsView } from "./voice/videoStats";
import { Icon } from "./Icon";
import { t } from "./i18n";

/**
 * The viewer's statistics of one received video (a screen share that lags: where does it lag?), 22 September 2026,
 * user's wish. A small box in the video's corner, read every second from the receiver's raw report
 * (`VoiceClient.videoReceiveSample`, rates and the diagnosis in `voice/videoStats.ts`); shown on the stage's tile and in a
 * pop-out window after the button in the tile's actions. It takes no clicks, so the tile behind it still enlarges.
 */
const POLL_MS = 1000;

export function useVideoStats(client: VoiceClient, tileId: string): VideoStatsView | null {
  const [view, setView] = useState<VideoStatsView | null>(null);
  const prev = useRef<InboundVideoSample | null>(null);
  useEffect(() => {
    prev.current = null; setView(null);
    let stopped = false;
    const read = async () => {
      const sample = await client.videoReceiveSample(tileId);
      if (stopped) return;
      if (!sample) { prev.current = null; setView(null); return; }
      setView(deriveVideoStats(prev.current, sample));
      prev.current = sample;
    };
    void read();
    const timer = setInterval(() => { void read(); }, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [client, tileId]);
  return view;
}

const n = (v: number | null): string | number => (v === null ? "?" : v);
const DX = { starting: "stats.dxStarting", ok: "stats.dxOk", network: "stats.dxNetwork", decoder: "stats.dxDecoder", sender: "stats.dxSender" } as const;

export function VideoStatsOverlay({ client, tileId }: { client: VoiceClient; tileId: string }) {
  const v = useVideoStats(client, tileId);
  if (!v) return <div className="tile-stats" role="status"><div className="dx-starting">{t("stats.dxStarting")}</div></div>;
  const decoder = v.decoder ? `${v.decoder}${v.hardware === null ? "" : ` (${t(v.hardware ? "stats.hardware" : "stats.software")})`}` : "?";
  return (
    <div className="tile-stats" role="status">
      <div>{t("stats.codecRow", { codec: v.codec ?? "?", decoder })}</div>
      <div>{t("stats.pictureRow", { w: v.width || "?", h: v.height || "?", decoded: v.fpsDecoded, received: v.fpsReceived })}</div>
      <div>{t("stats.rateRow", { rate: fmtBitrate(v.kbps), loss: n(v.lossPercent), rtt: n(v.rttMs) })}</div>
      <div>{t("stats.bufferRow", { buffer: n(v.jitterBufferMs), decode: n(v.decodeMs), jitter: n(v.interFrameJitterMs) })}</div>
      <div>{t("stats.freezeRow", { freezes: v.freezes, ms: v.freezeMs, dropped: v.framesDropped, keys: v.keyFrames })}</div>
      <div className={`dx-${v.diagnosis}`}>{t(DX[v.diagnosis])}</div>
    </div>
  );
}

/** The button in a tile's actions that shows or hides the overlay. */
export function VideoStatsButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return <button className={`icon ${on ? "on" : ""}`} aria-pressed={on} title={t(on ? "stage.statsOff" : "stage.stats")} aria-label={t(on ? "stage.statsOff" : "stage.stats")}
    onClick={(event) => { event.stopPropagation(); onToggle(); }}><Icon name="activity" /></button>;
}
