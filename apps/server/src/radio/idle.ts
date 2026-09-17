/**
 * Turns a voice channel's radio off once the channel has been empty for a while (server setting `radioAutoStop`, default
 * on, user's requirement: two minutes). The radio lives in the database and would otherwise play on for nobody: the next
 * person to join would walk into whatever was left running days ago.
 *
 * `sync` gets the channels that are idle right now (radio on, nobody inside; an empty list while the setting is off). A
 * channel that stays idle for `delayMs` is handed to `stop`, which checks once more against the database before it acts;
 * a channel that leaves the list (somebody joined, the radio went off, the setting was turned off) is forgotten. The
 * clock starts when a channel is first seen idle, so after a restart an abandoned radio gets the full delay again.
 */
export class RadioIdleStop {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly stop: (channelId: string) => void, private readonly delayMs: number) {}

  sync(idleChannelIds: string[]): void {
    const idle = new Set(idleChannelIds);
    for (const [channelId, timer] of this.timers) {
      if (!idle.has(channelId)) { clearTimeout(timer); this.timers.delete(channelId); }
    }
    for (const channelId of idle) {
      if (this.timers.has(channelId)) continue;
      const timer = setTimeout(() => { this.timers.delete(channelId); this.stop(channelId); }, this.delayMs);
      timer.unref();
      this.timers.set(channelId, timer);
    }
  }

  close(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
