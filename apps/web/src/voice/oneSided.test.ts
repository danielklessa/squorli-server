import { describe, expect, it } from "vitest";
import { OneSidedDetector } from "./oneSided";

const feed = (d: OneSidedDetector, frames: number, left: number, right: number) => { for (let i = 0; i < frames; i++) d.update(left, right); return d.verdict; };

describe("OneSidedDetector", () => {
  it("finds the channel an iPhone puts its mono microphone on, after half a second of signal", () => {
    const d = new OneSidedDetector();
    expect(feed(d, 9, 0.004, 0)).toBe("stereo");
    expect(feed(d, 1, 0.004, 0)).toBe("left");
    expect(feed(new OneSidedDetector(), 10, 0, 0.02)).toBe("right");
  });
  it("leaves real stereo alone, also when it is panned far to one side", () => {
    expect(feed(new OneSidedDetector(), 200, 0.05, 0.04)).toBe("stereo");
    expect(feed(new OneSidedDetector(), 200, 0.1, 0.003)).toBe("stereo");
  });
  it("learns nothing from silence and keeps its verdict through pauses", () => {
    const d = new OneSidedDetector();
    expect(feed(d, 200, 0.0001, 0)).toBe("stereo");
    feed(d, 10, 0.01, 0);
    expect(feed(d, 200, 0, 0)).toBe("left");
  });
  it("returns to stereo when the second channel comes alive, and does not flap in between", () => {
    const d = new OneSidedDetector();
    feed(d, 10, 0.01, 0);
    expect(feed(d, 50, 0.01, 0.0003)).toBe("left"); // 3 %: between the two ratios
    expect(feed(d, 10, 0.01, 0.008)).toBe("stereo");
  });
  it("needs the evidence in a row", () => {
    const d = new OneSidedDetector();
    for (let i = 0; i < 30; i++) d.update(0.01, i % 5 === 0 ? 0.01 : 0);
    expect(d.verdict).toBe("stereo");
  });
});
