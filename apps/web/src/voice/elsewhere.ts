import type { VoiceMember } from "@squorli/protocol";

/**
 * The voice channel of a server in which the user's account already sits, from another device or tab: the server's voice
 * presence (channelId -> members) names each account once per channel, whichever connection put it there. The caller
 * leaves out the case where that seat is its own (22 September 2026, the confirm before a join from a second client).
 */
export function voiceElsewhere(voice: Record<string, readonly VoiceMember[]>, userId: string | null): string | null {
  if (!userId) return null;
  for (const [channelId, members] of Object.entries(voice)) if (members.some((m) => m.userId === userId)) return channelId;
  return null;
}
