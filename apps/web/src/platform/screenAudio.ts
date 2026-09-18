import type { DesktopBridge } from "./bridge";

/**
 * Desktop app on Windows: the audio of a screen share that the shell captures itself (one window's, or the system's without
 * the app; apps/desktop/src/main/windowAudio.ts). The shell sends PCM chunks; an AudioWorklet (public/worklets/pcm-player.js)
 * turns them into a continuous signal and a MediaStream destination into a track the voice client publishes as the share's
 * audio. A browser never gets here: its own `getDisplayMedia` audio track applies.
 */
const START_TIMEOUT_MS = 4000;

export function screenAudio(bridge: DesktopBridge) {
  let context: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let expected = false;
  let started: { resolve: (track: MediaStreamTrack | null) => void; promise: Promise<MediaStreamTrack | null> } | null = null;

  const newStart = () => { let resolve!: (track: MediaStreamTrack | null) => void; const promise = new Promise<MediaStreamTrack | null>((r) => { resolve = r; }); started = { resolve, promise }; };

  async function open(): Promise<MediaStreamTrack | null> {
    try {
      close();
      context = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
      await context.audioWorklet.addModule("/worklets/pcm-player.js");
      node = new AudioWorkletNode(context, "pcm-player", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      const destination = context.createMediaStreamDestination();
      node.connect(destination);
      if (context.state !== "running") await context.resume().catch(() => {});
      return destination.stream.getAudioTracks()[0] ?? null;
    } catch (err) { console.warn("screen audio: could not start the player", err); close(); return null; }
  }
  function close() {
    node?.disconnect(); node = null;
    void context?.close().catch(() => {}); context = null;
  }

  bridge.onScreenAudio((event) => {
    if (event.type === "start") { if (!started) newStart(); void open().then((track) => started?.resolve(track)); }
    else if (event.type === "data") node?.port.postMessage(event.pcm);
    else { started?.resolve(null); started = null; close(); }
  });

  return {
    /** The picker's answer: will the shell capture audio for the share that starts now? */
    expect(capture: boolean) { expected = capture; started = null; if (capture) newStart(); },
    /** Right after the share started: the track of the shell's capture, or null when this share has none. */
    async take(): Promise<MediaStreamTrack | null> {
      if (!expected || !started) return null;
      expected = false;
      return Promise.race([started.promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), START_TIMEOUT_MS))]);
    },
    stop() { expected = false; started = null; bridge.stopScreenAudio(); close(); },
  };
}
