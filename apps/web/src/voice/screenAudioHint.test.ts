import { describe, expect, it } from "vitest";
import { t } from "../i18n";
import { explainScreenAudio } from "./voiceClient";

describe("explainScreenAudio", () => {
  const silent = { screenOn: true, screenAudio: false } as const;

  it("says nothing while nothing is shared, or while the share has audio or it is not known yet", () => {
    expect(explainScreenAudio({ screenOn: false, screenAudio: false })).toBe("");
    expect(explainScreenAudio({ screenOn: true, screenAudio: true }, { audioPossible: true })).toBe("");
    expect(explainScreenAudio({ screenOn: true, screenAudio: null }, { audioPossible: true })).toBe("");
  });

  // User's report (18 September 2026): the desktop app talked about the "browser dialog", which it does not have.
  it("points the desktop app to its own picker, and is honest where the app cannot send audio", () => {
    expect(explainScreenAudio(silent, { audioPossible: true })).toBe(t("voice.screenNoAudioApp"));
    expect(explainScreenAudio(silent, { audioPossible: false })).toBe(t("voice.screenNoAudioAppOs"));
    expect(explainScreenAudio(silent, { audioPossible: true })).not.toMatch(/Browser|browser/);
  });
});
