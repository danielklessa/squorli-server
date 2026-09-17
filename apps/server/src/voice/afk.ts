/**
 * Moves absent members into the AFK channel (server setting `afkChannelId`, user's requirement of 17 September 2026).
 *
 * Who is absent is known to the hub (every connection of the user has reported `activity` idle, i.e. AFK_AFTER_MS without
 * input or speaking). That time is the same everywhere, because the directory shows the state to friends too (user's
 * decision: no time of its own per server), so a member sitting in a voice channel is moved the moment they turn absent.
 * The move is the moderation event `voice.moved` with `reason: "afk"`: the client joins the AFK channel itself and offers
 * the way back.
 *
 * Not moved (the AFK status shows regardless): members already in the AFK channel, and members of a channel that is
 * showing a video (Twitch or YouTube as the radio's source: watching together needs no input, user's decision); they
 * follow once the video has ended. Each absence moves a member at most once, so somebody who walks back into a channel
 * without touching anything else (or a client that does not follow) is not pushed around every few seconds.
 */
export type AfkMoveInput = {
  afkChannelId: string | null;
  /** Absent users (Hub.afkUsers). */
  afk: string[];
  /** The voice channel a user sits in (VoicePresence.channelOfUser). */
  channelOf: (userId: string) => string | undefined;
  /** Channels nobody is moved out of (a video is showing). */
  exemptChannels: ReadonlySet<string>;
};

export class AfkMover {
  /** Users already moved during their current absence. */
  private readonly moved = new Set<string>();

  /** Who has to be moved now; remembers them. */
  due(input: AfkMoveInput): { userId: string; from: string }[] {
    const absent = new Set(input.afk);
    for (const userId of this.moved) if (!absent.has(userId)) this.moved.delete(userId);
    if (!input.afkChannelId) return [];
    const out: { userId: string; from: string }[] = [];
    for (const userId of input.afk) {
      if (this.moved.has(userId)) continue;
      const from = input.channelOf(userId);
      if (!from || from === input.afkChannelId || input.exemptChannels.has(from)) continue;
      this.moved.add(userId);
      out.push({ userId, from });
    }
    return out;
  }
}
