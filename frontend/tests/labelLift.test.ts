import { describe, expect, it } from "vitest";
import { MAX_LIFT, liftLabels, type LabelBox } from "@/systems/labelLift";

/** A 100×20 chip with its bottom centre at (x, y), and a 160×60 bubble when ``says``. */
const box = (id: string, x: number, y: number, says = false): LabelBox => ({
  id,
  x,
  y,
  chip: { width: 100, height: 20 },
  bubble: says ? { width: 160, height: 60 } : null,
});

describe("liftLabels", () => {
  it("leaves people whose labels do not touch where they are", () => {
    const lifts = liftLabels([box("a", 0, 100), box("b", 300, 100, true)]);
    expect([...lifts]).toEqual([
      ["a", { by: 0, show: "all" }],
      ["b", { by: 0, show: "all" }],
    ]);
  });

  it("lifts the farther label (higher on the screen) clear of the nearer", () => {
    const lifts = liftLabels([box("b", 30, 90), box("a", 0, 100)]);
    expect(lifts.get("a")).toEqual({ by: 0, show: "all" });
    // b's chip bottom (90) goes 4px above a's chip top (80).
    expect(lifts.get("b")).toEqual({ by: 14, show: "all" });
  });

  it("stacks a crowd, each clear of every nearer one where it now is", () => {
    const lifts = liftLabels([
      box("c", 20, 80, true),
      box("b", 10, 90, true),
      box("a", 0, 100, true),
    ]);
    expect(lifts.get("a")?.by).toBe(0);
    // b (30..90) over a (40..100): b's bottom to 36.
    expect(lifts.get("b")?.by).toBe(54);
    // c clears a, then b where b was lifted to (-24..36): bottom to -28.
    expect(lifts.get("c")?.by).toBe(108);
  });

  it("keeps only the chip of one whose bubble has no room", () => {
    // a's tall, wide bubble leaves no room over b for b's bubble, but b's
    // narrower chip clears it.
    const lifts = liftLabels([
      { ...box("a", 0, 300), bubble: { width: 400, height: 300 } },
      box("b", 260, 290, true),
    ]);
    expect(lifts.get("b")).toEqual({ by: 0, show: "chip" });
  });

  it("shows nothing of one that cannot clear the crowd even as a chip", () => {
    const crowd = ["f", "e", "d", "c", "b", "a"].map((id, i) =>
      box(id, i * 10, 50 + i * 10, true),
    );
    const lifts = liftLabels(crowd);
    expect(lifts.get("f")?.show).toBe("none");
    // The rest stay clear of each other: none is drawn over a nearer one.
    expect([...lifts.values()].every((lift) => lift.by <= MAX_LIFT)).toBe(true);
  });
});
