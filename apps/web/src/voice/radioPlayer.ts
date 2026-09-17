/**
 * Web radio of the voice channel you are in. The stream does not come through LiveKit: every client plays the station's
 * address itself in a plain <audio> element (no CORS needed that way), so everyone chooses their own volume or turns the
 * radio off for themselves. Volume and "off" are stored per device (`chat.radio.v2`): like the per-person volumes they
 * depend on the headset in front of this browser. The volume is only stored once the user has set it, so until then the
 * default applies (and a later change of the default reaches everyone who never touched the slider). Turned off means disconnected: no data is loaded and the station never
 * sees this listener. Deafening only silences the element, so the radio is back at once afterwards.
 */
const KEY = "chat.radio.v2";
/** v1 (first day of the radio, never released) always stored the volume, also the default of that day: dropped. */
const OLD_KEY = "chat.radio.v1";
/** Stations are mastered much louder than a voice: 5 % until the user sets their own volume (user's requirement). */
export const RADIO_DEFAULT_VOLUME = 0.05;
const RETRY_MS = [2000, 5000, 15000, 30000];

export type RadioSettings = { volume: number; muted: boolean };
export type RadioStatus = "off" | "connecting" | "playing" | "blocked" | "error";
export type RadioState = RadioSettings & { status: RadioStatus };

/** Stored JSON -> settings; broken or foreign data yields the defaults. */
export function parseRadioSettings(raw: string | null): RadioSettings {
  const fallback = { volume: RADIO_DEFAULT_VOLUME, muted: false };
  if (!raw) return fallback;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return fallback;
    const { volume, muted } = data as Record<string, unknown>;
    return { volume: typeof volume === "number" && Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : RADIO_DEFAULT_VOLUME, muted: muted === true };
  } catch { return fallback; }
}

/** Has the user set a volume of their own? Only then it is stored. */
export function hasOwnVolume(raw: string | null): boolean {
  try { const v = (JSON.parse(raw ?? "null") as { volume?: unknown } | null)?.volume; return typeof v === "number" && Number.isFinite(v); } catch { return false; }
}

/** What is written to the device: the off switch always, the volume only when it is the user's own. */
export function storedRadioSettings(settings: RadioSettings, ownVolume: boolean): { volume?: number; muted: boolean } {
  return ownVolume ? { volume: settings.volume, muted: settings.muted } : { muted: settings.muted };
}

/** Why the element is (not) loading: the radio runs only with an address, and not while the user has turned it off. */
export function shouldLoad(url: string | null, settings: RadioSettings): boolean {
  return url !== null && !settings.muted;
}

export class RadioPlayer {
  state: RadioState;
  private listeners = new Set<(s: RadioState) => void>();
  private el: HTMLAudioElement | null = null;
  private url: string | null = null;
  private deafened = false;
  private sinkId: string | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private unblock: (() => void) | null = null;
  private ownVolume: boolean;

  constructor() {
    let stored: string | null = null;
    try { stored = localStorage.getItem(KEY); localStorage.removeItem(OLD_KEY); } catch { /* blocked storage: defaults */ }
    this.state = { ...parseRadioSettings(stored), status: "off" };
    this.ownVolume = hasOwnVolume(stored);
  }

  subscribe(fn: (s: RadioState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private patch(p: Partial<RadioState>) {
    this.state = { ...this.state, ...p };
    for (const fn of this.listeners) fn(this.state);
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify(storedRadioSettings(this.state, this.ownVolume))); } catch { /* still applies for this session */ }
  }

  /** What the voice channel plays; null = no radio (or not in a voice channel). */
  setStream(url: string | null) {
    if (url === this.url) return;
    this.url = url;
    this.attempts = 0;
    this.apply();
  }

  setVolume(volume: number) {
    const v = Math.max(0, Math.min(1, volume));
    this.ownVolume = true;
    this.patch({ volume: v });
    if (this.el) this.el.volume = v;
    this.save();
  }

  /** The user's own off switch: disconnects from the station, the channel's radio keeps running for everyone else. */
  setMuted(muted: boolean) {
    if (muted === this.state.muted) return;
    this.patch({ muted });
    this.save();
    this.attempts = 0;
    this.apply();
  }

  /** Follows the voice client's deafen. */
  setDeafened(on: boolean) {
    this.deafened = on;
    if (this.el) this.el.muted = on;
  }

  /** Same output device as the voices (Chromium only; elsewhere the system default). */
  setOutputDevice(deviceId: string | null) {
    this.sinkId = deviceId;
    this.applySink();
  }

  /** From a click: start playback the browser blocked, or try again at once after an error. */
  resume() {
    this.attempts = 0;
    this.apply();
  }

  private applySink() {
    const el = this.el as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId) void el.setSinkId(this.sinkId ?? "").catch(() => {});
  }

  private clearTimers() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.unblock) { this.unblock(); this.unblock = null; }
  }

  private apply() {
    this.clearTimers();
    if (!shouldLoad(this.url, this.state)) { this.unload(); this.patch({ status: "off" }); return; }
    const el = this.element();
    el.volume = this.state.volume;
    el.muted = this.deafened;
    el.src = this.url!;
    this.patch({ status: "connecting" });
    this.applySink();
    const url = this.url;
    el.play().catch((err: unknown) => {
      if (url !== this.url || this.state.muted) return; // superseded meanwhile (a new src aborts the old play())
      if (err instanceof DOMException && err.name === "NotAllowedError") this.blocked();
      // Everything else also arrives as the element's "error" event, which schedules the retry.
    });
  }

  /** Autoplay refused (no gesture in this document yet): the next click or key anywhere starts the radio. */
  private blocked() {
    this.patch({ status: "blocked" });
    const go = () => this.resume();
    document.addEventListener("pointerdown", go, { once: true, capture: true });
    document.addEventListener("keydown", go, { once: true, capture: true });
    this.unblock = () => { document.removeEventListener("pointerdown", go, true); document.removeEventListener("keydown", go, true); };
  }

  /** A live stream that ends or fails is reconnected, slower each time; the menu shows the error from the third failure on. */
  private failed() {
    if (!shouldLoad(this.url, this.state) || this.retryTimer) return;
    const delay = RETRY_MS[Math.min(this.attempts, RETRY_MS.length - 1)]!;
    this.attempts++;
    this.patch({ status: this.attempts >= 3 ? "error" : "connecting" });
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.apply(); }, delay);
  }

  private element(): HTMLAudioElement {
    if (this.el) return this.el;
    const el = new Audio();
    el.preload = "none";
    el.addEventListener("playing", () => { this.attempts = 0; this.patch({ status: "playing" }); });
    el.addEventListener("waiting", () => { if (this.state.status === "playing") this.patch({ status: "connecting" }); });
    el.addEventListener("error", () => this.failed());
    el.addEventListener("ended", () => this.failed());
    this.el = el;
    return el;
  }

  /** Really close the connection: pausing alone keeps a live stream downloading. */
  private unload() {
    const el = this.el;
    if (!el) return;
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
}
