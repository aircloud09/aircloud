import { afterEach, describe, expect, it } from "vitest";
import { material, setNightView } from "../src/components/iso/isoFurniture";
import { ISO_COLORS as C } from "../src/components/iso/isoPalette";

const hex = (m: { color: { getHexString(): string } }): string =>
  `#${m.color.getHexString()}`;

afterEach(() => setNightView(false));

describe("setNightView", () => {
  it("darkens the sky and towers in the windows and brings them back", () => {
    const pane = material(C.window, { opacity: 0.85 });
    const towers = material(C.skyline);
    setNightView(true);
    expect(hex(pane)).toBe(C.nightWindow);
    expect(hex(towers)).toBe(C.nightSkyline);
    setNightView(false);
    expect(hex(pane)).toBe(C.window);
    expect(hex(towers)).toBe(C.skyline);
  });

  it("gives windows made at night the night colours", () => {
    setNightView(true);
    expect(hex(material(C.window, { opacity: 0.5 }))).toBe(C.nightWindow);
  });

  it("leaves every other colour alone", () => {
    const wall = material(C.wall, { emissive: C.wallGlow });
    setNightView(true);
    expect(hex(wall)).toBe(C.wall);
  });
});
