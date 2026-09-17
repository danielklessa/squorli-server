import { radioPositionAt, type RadioPlayback } from "@squorli/protocol";
import { YT } from "./youtube";

/**
 * Watching a video in step, pure part: what to do with one report of the local player, given where the video stands for
 * everyone (protocol RadioPlayback). Members with CONTROL_RADIO steer through their own player: what they do there is
 * published for everyone. Everybody else follows: their player is brought back to the shared state, also after they
 * paused or moved it themselves (they can turn the radio off for themselves instead). Videos only: a live stream is left
 * to each viewer (user's decision), nothing is published or corrected there.
 *
 * Telling a controller's own action from everything else a player does by itself:
 * - paused while it should play, or playing while it should be paused: only a person does that (buffering and ads show as
 *   other states). A pause only counts once the player has actually played since we last told it to: a player that never
 *   started (the browser refused) must not pause the video for everyone;
 * - ahead of the shared place: a person moved it forward (no player runs ahead by itself);
 * - the time went backwards: a person moved it back;
 * - merely behind the shared place: that is buffering or a late start, never an action, and gets corrected instead.
 */
export type PlayerReport = { state: number; time: number; rate: number; live: boolean };
export type SyncAction =
  | { kind: "none" }
  | { kind: "publish"; playback: { playing: boolean; position: number; rate: number } }
  /** `seekTo`/`play`/`rate` null = leave as it is. `corrected` = the viewer's own pause or move was undone (tell them why). `lag` = only caught up. */
  | { kind: "apply"; seekTo: number | null; play: boolean | null; rate: number | null; corrected: boolean; lag: boolean };

/** How far a playing video may be off before it is moved; a paused one should show the same picture. */
export const SYNC_TOLERANCE = 2, SYNC_TOLERANCE_PAUSED = 0.5;
const BACK_JUMP = 1;

export function decideSync(input: {
  shared: RadioPlayback; serverNow: number; report: PlayerReport;
  /** The last report in a settled state (playing or paused): what the time is compared with to see a move backwards. */
  stable: PlayerReport | null;
  canControl: boolean;
  /** The shared state just changed, or the player just loaded: nothing the player shows is the viewer's own action. */
  force: boolean;
  /** false shortly after catching up: a connection that buffers longer than the tolerance must not be moved again and again. */
  allowLagSeek: boolean;
  /** The player has been seen playing since we last told it to play (or since it loaded). */
  playedSinceCommand: boolean;
}): SyncAction {
  const { shared, report, stable, canControl, force } = input;
  const st = report.state;
  // A live stream is not steered for everyone (user's decision): everybody's player is their own, pause included.
  if (report.live) return { kind: "none" };
  if (st === YT.ENDED && !force) return { kind: "none" };
  const target = radioPositionAt(shared, input.serverNow);
  const settled = st === YT.PLAYING || st === YT.PAUSED;
  const tolerance = shared.playing ? SYNC_TOLERANCE : SYNC_TOLERANCE_PAUSED;
  const movedBack = settled && stable !== null && report.time < stable.time - BACK_JUMP;
  const ahead = settled && report.time > target + tolerance;
  const toggled = (st === YT.PAUSED && shared.playing && input.playedSinceCommand) || (st === YT.PLAYING && !shared.playing);
  const ownAction = !force && settled && (toggled || movedBack || ahead);
  const position = Math.max(0, report.time);

  if (ownAction && canControl) return { kind: "publish", playback: { playing: st === YT.PLAYING, position, rate: report.rate } };
  if (!force && canControl && settled && report.rate !== shared.rate) return { kind: "publish", playback: { playing: st === YT.PLAYING, position, rate: report.rate } };

  const running = st === YT.PLAYING || st === YT.BUFFERING;
  // A controller's player that buffers while the video is paused for everyone is about to play: they pressed play, and
  // that gets published once it plays. Pausing it here would swallow their play (seen in the browser check).
  const startingUp = st === YT.BUFFERING && canControl && !force;
  const play = shared.playing && !running ? true : !shared.playing && running && !startingUp ? false : null;
  const off = Math.abs(report.time - target) > tolerance;
  const behindOnly = off && !ownAction && !force;
  // While buffering the time stands still anyway: moving again would only start the buffering over.
  const seekTo = off && (force || ownAction || (input.allowLagSeek && st !== YT.BUFFERING)) ? target : null;
  const rate = report.rate !== shared.rate ? shared.rate : null;
  if (seekTo === null && play === null && rate === null) return { kind: "none" };
  return { kind: "apply", seekTo, play, rate, corrected: ownAction && !canControl, lag: behindOnly && seekTo !== null };
}
