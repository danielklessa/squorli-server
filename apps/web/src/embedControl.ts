import type { RadioPlayback } from "@squorli/protocol";
import { isTwitchPlayerSignal, twitchAudioCommands, twitchIsIdle, twitchPlayCommand, twitchPlaybackEvent } from "./twitch";
import { decideSync, type PlayerReport } from "./watchSync";
import { YT, readYoutubeMessage, youtubeAudioCommands, youtubeCommand, youtubeErrorKind, youtubeListening } from "./youtube";

/**
 * What drives an embedded player (Twitch, YouTube) once its iframe exists, without React: the component (EmbedPlayer.tsx)
 * hands in the player's messages and a way to post to it, wherever the iframe lives (in the page or in the pop-out window).
 */
export type EmbedLink = {
  post: (data: unknown) => void;
  /** Is the page the iframe lives in hidden right now (another tab, minimized)? */
  isHidden: () => boolean;
};

export interface EmbedControl {
  /** The iframe (or the pop-out page) is there: messages can be posted. */
  start(): void;
  setAudio(volume: number, muted: boolean): void;
  onMessage(data: unknown): void;
  /** The page the iframe lives in became visible again. */
  onVisible(): void;
  /** The viewer clicked or typed somewhere in our page: what the browser refused without that may work now. */
  onGesture(): void;
  close(): void;
}

/**
 * Sound the browser refuses. Browsers only let a page start sound after the viewer did something in it, and that is not
 * as lasting as it looks: measured in Chrome (17 September 2026), a page whose player had been playing in the pop-out
 * window could not start a new player WITH sound afterwards, although it still counted as "has been active"; muted it
 * started, and after any click in the page it started with sound. So a player that should play but does not is started
 * muted (that is always allowed), the viewer is told, and the next click or key press in the page turns the sound on.
 */
const RESTART_TRIES = 4, RESTART_EVERY_MS = 1500, MUTED_FROM_TRY = 3;
/** A player that came up without starting (seen after coming back from the pop-out window) gets this long to start by itself. */
const IDLE_GRACE_MS = 3000;

/** Twitch: our volume, and starting the player again after Twitch paused it for being hidden (twitch.ts). */
export class TwitchControl implements EmbedControl {
  private readonly seen = new Set<string>();
  private audio = { volume: 0, muted: true };
  private ready = false;
  private playing = false;
  private pausedByViewer = false;
  private tries = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private soundBlocked = false;

  constructor(private readonly link: EmbedLink, private readonly onSoundBlocked: () => void = () => {}) {}

  start(): void { /* the player reports by itself */ }

  onGesture(): void {
    if (!this.soundBlocked) return;
    this.soundBlocked = false;
    this.sendAudio();
    // Twitch does not start a refused player muted either: now that the viewer clicked, start it.
    if (!this.playing && !this.pausedByViewer) { this.tries = 0; this.tryPlay(); }
  }

  setAudio(volume: number, muted: boolean): void {
    this.audio = { volume, muted };
    if (this.ready) this.sendAudio();
  }

  onMessage(data: unknown): void {
    const playback = twitchPlaybackEvent(data);
    if (playback === "playing") { this.playing = true; this.pausedByViewer = false; this.tries = 0; this.stopTrying(); }
    // Nobody can press pause in a page they do not see: a pause while hidden is Twitch's own.
    else if (playback === "paused") { this.playing = false; this.pausedByViewer = !this.link.isHidden(); }
    // Sitting there without playing, and not because the viewer wanted it: start it (a few tries: the channel may be offline).
    if (twitchIsIdle(data) === true && !this.playing && !this.pausedByViewer && this.timer === null && this.tries < RESTART_TRIES && !this.link.isHidden()) this.timer = setTimeout(() => this.tryPlay(), IDLE_GRACE_MS);
    if (!isTwitchPlayerSignal(data)) return;
    // The player says when it can take commands; each kind of sign is answered once (a state update comes every second).
    const kind = String((data as { eventName: unknown }).eventName);
    if (this.seen.has(kind)) return;
    this.seen.add(kind);
    this.ready = true;
    this.sendAudio();
  }

  onVisible(): void {
    if (this.playing || this.pausedByViewer) return;
    this.tries = 0;
    this.tryPlay();
  }

  close(): void { this.stopTrying(); }

  private sendAudio() { for (const command of twitchAudioCommands(this.audio.volume, this.audio.muted || this.soundBlocked)) this.link.post(command); }

  private tryPlay() {
    this.stopTrying();
    if (this.playing || this.link.isHidden() || this.tries >= RESTART_TRIES) return;
    this.tries++;
    // Still not playing after two tries: most likely the browser refuses the sound. Muted it may start.
    if (this.tries === MUTED_FROM_TRY && !this.soundBlocked && !this.audio.muted && this.audio.volume > 0) { this.soundBlocked = true; this.sendAudio(); this.onSoundBlocked(); }
    this.link.post(twitchPlayCommand());
    this.timer = setTimeout(() => this.tryPlay(), RESTART_EVERY_MS);
  }

  private stopTrying() { if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; } }
}

export type YoutubeControlOptions = {
  /** The server's clock (ms): local time plus the offset learned at the welcome. */
  serverNow: () => number;
  canControl: () => boolean;
  publish: (playback: { playing: boolean; position: number; rate: number }) => Promise<unknown>;
  /** The viewer paused or moved the video without the permission to: it was brought back. */
  onCorrected: () => void;
  onError: (kind: "embedding" | "missing" | "other") => void;
  /** The browser refuses to start the player with sound: it was started muted, the next click in the page turns the sound on. */
  onSoundBlocked: () => void;
};

const LISTEN_EVERY_MS = 250, LISTEN_TRIES = 240; // a minute: the player's page may load slowly
/** After commands the player needs a moment; what it reports meanwhile is not the viewer's doing. */
const SETTLE_MS = 2500;
/** After catching up, do not catch up again for a while (a connection that buffers for longer than the tolerance). */
const LAG_PAUSE_MS = 10_000;
const PUBLISH_EVERY_MS = 300;
/** A player that is not playing reports nothing: look at it ourselves (a pause made while we were not judging, a player that did not start). */
const IDLE_CHECK_MS = 1000;
/** Should be playing, was told to several times, still is not: the browser refuses the sound (see RESTART_TRIES above). */
const SOUND_BLOCKED_AFTER_MS = 4000;

/** YouTube: our volume, and the video kept in step with everyone (watchSync.ts). */
export class YoutubeControl implements EmbedControl {
  private audio = { volume: 0, muted: true };
  private answered = false;
  private listenTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private lastReportAt = 0;
  private playedSinceCommand = false;
  private notPlayingSince: number | null = null;
  private soundBlocked = false;
  private playedEver = false;
  private failed = false;
  private current: Partial<PlayerReport> = {};
  private stable: PlayerReport | null = null;
  private shared: RadioPlayback | null = null;
  private fromServer: RadioPlayback | null = null;
  private published: { playing: boolean; position: number; rate: number } | null = null;
  private force = true;
  private settleUntil = 0;
  private lagSeekFrom = 0;
  private publishFrom = 0;
  private publishing = false;
  private closed = false;

  constructor(private readonly link: EmbedLink, private readonly options: YoutubeControlOptions, private readonly now: () => number = () => Date.now()) {}

  start(): void {
    if (this.closed) return;
    this.idleTimer ??= setInterval(() => {
      const st = this.current.state;
      if (st !== YT.PLAYING && st !== YT.BUFFERING && this.now() - this.lastReportAt >= IDLE_CHECK_MS) this.evaluate();
      this.checkSound();
    }, IDLE_CHECK_MS);
    if (this.listenTimer !== null || this.answered) return;
    let tries = 0;
    const listen = () => { if (this.answered || ++tries > LISTEN_TRIES) this.stopListening(); else this.link.post(youtubeListening()); };
    this.listenTimer = setInterval(listen, LISTEN_EVERY_MS);
    listen();
  }

  setAudio(volume: number, muted: boolean): void {
    this.audio = { volume, muted };
    if (this.answered) this.sendAudio();
  }

  /** Where the video stands for everyone, from the server. Our own publication coming back is no news. */
  setShared(playback: RadioPlayback): void {
    const before = this.fromServer;
    this.fromServer = playback;
    if (before && before.playing === playback.playing && before.position === playback.position && before.rate === playback.rate && before.at === playback.at) return;
    const mine = this.published;
    this.shared = playback;
    if (mine && mine.playing === playback.playing && mine.position === playback.position && mine.rate === playback.rate) return;
    this.force = true;
    this.settleUntil = 0;
    this.evaluate();
  }

  onMessage(data: unknown): void {
    const info = readYoutubeMessage(data);
    if (!info || this.closed) return;
    if (!this.answered) { this.answered = true; this.stopListening(); this.sendAudio(); }
    // A video that cannot be played: say so once, and stop nudging the player (it shows YouTube's own message).
    if (info.error !== undefined) { if (!this.failed) this.options.onError(youtubeErrorKind(info.error)); this.failed = true; return; }
    this.lastReportAt = this.now();
    if (info.state !== undefined) this.current.state = info.state;
    if (info.state === YT.PLAYING) { this.playedSinceCommand = true; this.playedEver = true; }
    const st = this.current.state;
    if (st === YT.PLAYING || st === YT.BUFFERING || st === YT.ENDED) this.notPlayingSince = null;
    else this.notPlayingSince ??= this.now();
    if (info.time !== undefined) this.current.time = info.time;
    if (info.rate !== undefined) this.current.rate = info.rate;
    if (info.live !== undefined) this.current.live = info.live;
    this.evaluate();
  }

  onVisible(): void { /* YouTube keeps playing while hidden */ }

  onGesture(): void {
    if (!this.soundBlocked) return;
    this.soundBlocked = false;
    this.notPlayingSince = null;
    this.sendAudio();
  }

  /** Should play for everyone, the page is visible, and the player has not been playing for a while whatever we told it. */
  private checkSound() {
    // A live stream the viewer paused themselves is theirs to pause (watchSync.ts); one that never started is a refused one.
    if (this.current.live && this.playedEver) return;
    if (this.soundBlocked || this.failed || !this.answered || !this.shared?.playing || this.notPlayingSince === null || this.link.isHidden()) return;
    if (this.now() - this.notPlayingSince < SOUND_BLOCKED_AFTER_MS || this.audio.muted || this.audio.volume === 0) return;
    this.soundBlocked = true;
    this.sendAudio();
    this.link.post(youtubeCommand("playVideo"));
    this.playedSinceCommand = false;
    this.settleUntil = this.now() + SETTLE_MS;
    this.options.onSoundBlocked();
  }

  close(): void {
    this.closed = true;
    this.stopListening();
    if (this.idleTimer !== null) { clearInterval(this.idleTimer); this.idleTimer = null; }
  }

  private stopListening() { if (this.listenTimer !== null) { clearInterval(this.listenTimer); this.listenTimer = null; } }
  private sendAudio() { for (const command of youtubeAudioCommands(this.audio.volume, this.audio.muted || this.soundBlocked)) this.link.post(command); }

  private evaluate() {
    const { state, time } = this.current;
    if (!this.shared || state === undefined || time === undefined || this.closed || this.failed) return;
    const report: PlayerReport = { state, time, rate: this.current.rate ?? 1, live: this.current.live ?? false };
    const settled = state === YT.PLAYING || state === YT.PAUSED;
    const now = this.now();
    if (now < this.settleUntil || this.publishing || now < this.publishFrom) { if (settled) this.stable = report; return; }
    const action = decideSync({ shared: this.shared, serverNow: this.options.serverNow(), report, stable: this.stable, canControl: this.options.canControl(), force: this.force, allowLagSeek: now >= this.lagSeekFrom, playedSinceCommand: this.playedSinceCommand });
    if (settled) this.stable = report;
    this.force = false;
    if (action.kind === "publish") { this.publish(action.playback); return; }
    if (action.kind !== "apply") return;
    if (action.rate !== null) this.link.post(youtubeCommand("setPlaybackRate", action.rate));
    if (action.seekTo !== null) this.link.post(youtubeCommand("seekTo", Math.round(action.seekTo * 10) / 10, true));
    if (action.play !== null) this.link.post(youtubeCommand(action.play ? "playVideo" : "pauseVideo"));
    if (action.play === true) this.playedSinceCommand = false;
    this.settleUntil = now + SETTLE_MS;
    if (action.lag) this.lagSeekFrom = now + LAG_PAUSE_MS;
    if (action.corrected) this.options.onCorrected();
  }

  private publish(playback: { playing: boolean; position: number; rate: number }) {
    // Count as the shared state at once: the server's answer takes a moment, and the player must not be judged against the old state meanwhile.
    this.published = playback;
    this.shared = { ...playback, at: this.options.serverNow() };
    this.publishing = true;
    this.publishFrom = this.now() + PUBLISH_EVERY_MS;
    this.options.publish(playback).catch(() => {
      // Refused (the permission is gone) or unreachable: back to what the server says.
      this.published = null;
      this.shared = this.fromServer;
      this.force = true;
    }).finally(() => { this.publishing = false; if (!this.closed) this.evaluate(); });
  }
}
