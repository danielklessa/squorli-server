import { describe, expect, it } from "vitest";
import { micPermissionState, micRefusal } from "./micPermission";

describe("why the microphone was refused", () => {
  it("tells a stored refusal from a browser that never asked", () => {
    expect(micRefusal("denied")).toBe("denied");
    expect(micRefusal("prompt")).toBe("notAsked");
  });
  it("blames the system when the site is allowed or the browser does not tell", () => {
    expect(micRefusal("granted")).toBe("system");
    expect(micRefusal("unknown")).toBe("system");
  });
  it("is 'unknown' without a permissions API", async () => {
    expect(await micPermissionState()).toBe("unknown");
  });
});
