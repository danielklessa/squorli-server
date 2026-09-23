import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { joinErrorText, moveErrorText } from "./apiErrorText";
import { t } from "./i18n";

const refusal = (status: number, code: string | null) => new ApiError("POST", "/api/rtc-token", status, code, {});

describe("joinErrorText", () => {
  it("turns the server's codes into the catalog's sentences, never the request line", () => {
    expect(joinErrorText(refusal(403, "forbidden"))).toBe(t("voice.joinErr.forbidden"));
    expect(joinErrorText(refusal(403, "confined"))).toBe(t("voice.stickyBlocked"));
    expect(joinErrorText(refusal(409, "channel_full"))).toBe(t("voice.joinErr.full"));
    expect(joinErrorText(refusal(404, "unknown_channel"))).toBe(t("voice.joinErr.gone"));
    expect(joinErrorText(refusal(401, "unauthorized"))).toBe(t("voice.joinErr.session"));
    for (const [status, code] of [[403, "forbidden"], [403, "confined"], [409, "channel_full"], [404, "unknown_channel"], [401, "unauthorized"]] as const) expect(joinErrorText(refusal(status, code))).not.toContain("/api/");
  });
  it("keeps an unknown code readable and other errors as they are", () => {
    expect(joinErrorText(refusal(500, "boom"))).toBe(t("voice.joinErr.generic", { message: "POST /api/rtc-token -> 500 (boom)" }));
    expect(joinErrorText(new Error("no network"))).toBe("no network");
    expect(joinErrorText("x")).toBe("x");
  });
});

describe("moveErrorText", () => {
  it("has its own words for the move route", () => {
    expect(moveErrorText(refusal(403, "forbidden"))).toBe(t("members.moveErr.forbidden"));
    expect(moveErrorText(refusal(403, "confined"))).toBe(t("members.moveErr.confined"));
    expect(moveErrorText(refusal(403, "target_above_you"))).toBe(t("members.moveErr.aboveYou"));
    expect(moveErrorText(refusal(409, "not_in_voice"))).toBe(t("members.moveErr.notInVoice"));
    expect(moveErrorText(refusal(404, "not_found"))).toBe(t("members.moveErr.gone"));
    expect(moveErrorText(refusal(409, "channel_full"))).toBe(t("voice.joinErr.full"));
    expect(moveErrorText(refusal(400, "self"))).toBe(t("members.moveErr.generic", { message: "POST /api/rtc-token -> 400 (self)" }));
  });
});
