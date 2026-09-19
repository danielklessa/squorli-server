import { describe, expect, it } from "vitest";
import { detectMobile, isMobileDevice } from "./mobile";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("isMobileDevice", () => {
  it("recognises phones by their user agent", () => {
    expect(isMobileDevice({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isMobileDevice({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(true);
  });

  it("recognises an iPad that asks for the desktop site (it calls itself a Mac, but has a touch screen)", () => {
    expect(isMobileDevice({ userAgent: MAC, maxTouchPoints: 5 })).toBe(true);
    expect(isMobileDevice({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
  });

  it("does not take a Windows computer with a touch screen or a narrow window for a phone", () => {
    expect(isMobileDevice({ userAgent: WINDOWS, maxTouchPoints: 10 })).toBe(false);
    expect(isMobileDevice({ userAgent: WINDOWS, maxTouchPoints: 0, uaDataMobile: false })).toBe(false);
  });

  it("believes the browser where it says so itself", () => {
    expect(isMobileDevice({ userAgent: "", maxTouchPoints: 0, uaDataMobile: true })).toBe(true);
  });

  it("is false without a browser", () => {
    expect(detectMobile()).toBe(false);
  });
});
