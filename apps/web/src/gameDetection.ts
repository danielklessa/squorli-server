import type { CustomProgram, DetectedGame, RunningGame } from "./platform/bridge";
import type { Platform } from "./platform/types";

/**
 * Game detection of the desktop app (docs/features/games.md, user's decisions of 20 September 2026). Stage 2: everything
 * stays on this computer, nothing is sent to a server or the directory yet. Off until the user switches it on. The shell
 * reads which games the launchers installed and tells which one is in front (`platform.games`); this keeps the user's
 * settings per device (`chat.games.v1`): the switch, the games never to show, the programs added by hand. The hide list
 * lives on the device because it comes from what is installed here, and a list in the account would tell the directory's
 * operator what somebody owns and hides. When the display for others comes, the switch moves to the account's settings.
 */
const KEY = "chat.games.v1";
const MAX_HIDDEN = 2000;

export type GameSettings = { enabled: boolean; hidden: string[]; custom: CustomProgram[] };
export type GameState = { settings: GameSettings; /** The detected game, hidden or not. */ running: RunningGame | null; /** What others would see: the running game unless detection is off or the game is hidden. */ shown: RunningGame | null };

/** A stored value made safe (pure, tested). The shell checks the programs' paths once more. */
export function readGameSettings(raw: string | null): GameSettings {
  let value: unknown = null;
  try { value = raw ? JSON.parse(raw) : null; } catch { /* unreadable: the defaults */ }
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const hidden = Array.isArray(stored.hidden) ? [...new Set(stored.hidden.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 1100))].slice(0, MAX_HIDDEN) : [];
  const custom = Array.isArray(stored.custom) ? stored.custom.flatMap((entry): CustomProgram[] => {
    const program = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return typeof program.path === "string" && program.path && typeof program.name === "string" ? [{ path: program.path, name: program.name }] : [];
  }) : [];
  return { enabled: stored.enabled === true, hidden, custom };
}

export const shownGame = (settings: GameSettings, running: RunningGame | null): RunningGame | null => (settings.enabled && running && !settings.hidden.includes(running.id) ? running : null);

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export class GameDetection {
  private settings: GameSettings;
  private running: RunningGame | null = null;
  private current: GameState;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly source: NonNullable<Platform["games"]>, private readonly storage: Storage | null) {
    let raw: string | null = null;
    try { raw = storage?.getItem(KEY) ?? null; } catch { /* private mode */ }
    this.settings = readGameSettings(raw);
    this.current = this.snapshot();
  }

  /**
   * Tell the shell what is stored and listen for the running game; returns the cleanup. An effect's job, not the
   * constructor's: React's development mode runs every effect twice, and a cleanup that ended a subscription made in the
   * constructor left the detection deaf for good (the user's report, 21 September 2026).
   */
  start(): () => void {
    this.source.setWatch({ enabled: this.settings.enabled, custom: this.settings.custom });
    return this.source.subscribe((game) => { this.running = game; this.changed(); });
  }

  get state(): GameState { return this.current; }
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };

  setEnabled(enabled: boolean): void { this.save({ ...this.settings, enabled }, true); }
  setHidden(id: string, hidden: boolean): void {
    const rest = this.settings.hidden.filter((other) => other !== id);
    this.save({ ...this.settings, hidden: hidden ? [...rest, id] : rest }, false);
  }
  addCustom(program: CustomProgram): void {
    const rest = this.settings.custom.filter((other) => other.path.toLowerCase() !== program.path.toLowerCase());
    this.save({ ...this.settings, custom: [...rest, program] }, true);
  }
  removeCustom(path: string): void {
    const id = `custom:${path.toLowerCase()}`;
    this.save({ ...this.settings, custom: this.settings.custom.filter((other) => other.path.toLowerCase() !== path.toLowerCase()), hidden: this.settings.hidden.filter((other) => other !== id) }, true);
  }
  /** The installed games and added programs, read again by the shell. */
  scan(): Promise<DetectedGame[]> { return this.source.scan(); }
  pickProgram(): Promise<CustomProgram | null> { return this.source.pickProgram(); }
  /** The added program behind a list entry, to remove it; null = an installed game. */
  customOf(id: string): CustomProgram | null { return this.settings.custom.find((program) => `custom:${program.path.toLowerCase()}` === id) ?? null; }

  private save(next: GameSettings, tellShell: boolean): void {
    this.settings = next;
    try { this.storage?.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: for this session only */ }
    if (tellShell) this.source.setWatch({ enabled: next.enabled, custom: next.custom });
    this.changed();
  }
  private snapshot(): GameState { return { settings: this.settings, running: this.running, shown: shownGame(this.settings, this.running) }; }
  private changed(): void { this.current = this.snapshot(); for (const fn of this.listeners) fn(); }
}
