import { describe, expect, it } from "vitest";
import { cameraSwitch } from "./cameraSwitch";

const A = { deviceId: "cam-a", quality: "720p" as const };

describe("cameraSwitch", () => {
  it("lets LiveKit create the track when there is none", () => {
    expect(cameraSwitch(null, A)).toBe("enable");
  });

  it("unmutes the switched-off track when the same camera is wanted again", () => {
    expect(cameraSwitch({ muted: true, opened: A }, { ...A })).toBe("enable");
    expect(cameraSwitch({ muted: true, opened: A }, { deviceId: null, quality: "720p" })).toBe("enable");
  });

  it("opens the camera fresh when another one was picked while it was off (the reported bug)", () => {
    expect(cameraSwitch({ muted: true, opened: A }, { deviceId: "cam-b", quality: "720p" })).toBe("republish");
    expect(cameraSwitch({ muted: true, opened: A }, { deviceId: "cam-a", quality: "360p" })).toBe("republish");
  });

  it("restarts a running camera when device or resolution change", () => {
    expect(cameraSwitch({ muted: false, opened: A }, { deviceId: "cam-a", quality: "360p" })).toBe("restart");
    expect(cameraSwitch({ muted: false, opened: A }, { deviceId: "cam-b", quality: "720p" })).toBe("restart");
    expect(cameraSwitch({ muted: false, opened: A }, { ...A })).toBe("enable");
  });

  it("does not trust a track it did not open", () => {
    expect(cameraSwitch({ muted: true, opened: null }, A)).toBe("republish");
  });
});
