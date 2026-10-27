import { describe, expect, it } from "vitest";
import {
  DOZE_AFTER_MS,
  LOUNGE_ACT_MS,
  loungeAct,
} from "../src/systems/loungeActs";

describe("loungeAct", () => {
  it("starts with a coffee, then the phone, a book and the TV in turn", () => {
    const turns = [0, 1, 2, 3, 4].map((n) => loungeAct(n * LOUNGE_ACT_MS + 1));
    expect(turns).toEqual(["coffee", "phone", "book", "tv", "coffee"]);
  });

  it("dozes off after a long rest", () => {
    expect(loungeAct(DOZE_AFTER_MS - 1)).not.toBe("doze");
    expect(loungeAct(DOZE_AFTER_MS)).toBe("doze");
    expect(loungeAct(DOZE_AFTER_MS * 10)).toBe("doze");
  });

  it("treats a clock running behind as the start of the rest", () => {
    expect(loungeAct(-5000)).toBe("coffee");
  });
});
