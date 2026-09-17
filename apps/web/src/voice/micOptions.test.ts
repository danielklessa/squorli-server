import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceClient } from "./voiceClient";

afterEach(() => vi.unstubAllGlobals());

/** The channel's voice profile must reach LiveKit under the option names the SDK actually reads. */
function optionsFor(profile: { bitrate: number; stereo: boolean }) {
  vi.stubGlobal("document", { addEventListener: vi.fn() });
  const client = new VoiceClient({} as HTMLElement);
  Reflect.set(client, "audioProfile", profile);
  return (Reflect.get(client, "micPublishOptions") as () => Record<string, unknown>).call(client);
}

describe("microphone publish options", () => {
  it("hands the channel bitrate to LiveKit as audioPreset.maxBitrate", () => {
    // `audioBitrate` is no SDK option: it was ignored and every channel ran at the default 48 kbit/s.
    expect(optionsFor({ bitrate: 24, stereo: false })).toMatchObject({ audioPreset: { maxBitrate: 24_000 }, dtx: true, red: true, forceStereo: false });
    expect(optionsFor({ bitrate: 256, stereo: true })).toMatchObject({ audioPreset: { maxBitrate: 256_000 }, dtx: false, red: false, forceStereo: true });
    expect(optionsFor({ bitrate: 64, stereo: false })).not.toHaveProperty("audioBitrate");
  });
});
