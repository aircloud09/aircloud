import { afterEach, describe, expect, it } from "vitest";
import {
  choosePlace,
  placeKey,
  rememberPlace,
  rememberedPlaces,
  remembersAnything,
} from "@/systems/placeMemory";

describe("place memory", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  it("gives back the place one had while it is free", () => {
    expect(choosePlace(5, new Set([0, 1]), 3)).toBe(3);
  });

  it("takes the first free place when its own is taken or unknown", () => {
    expect(choosePlace(5, new Set([0, 3]), 3)).toBe(1);
    expect(choosePlace(5, new Set([0]), undefined)).toBe(1);
    expect(choosePlace(5, new Set(), 9)).toBe(0);
  });

  it("finds none when every place is taken", () => {
    expect(choosePlace(2, new Set([0, 1]), undefined)).toBe(-1);
  });

  it("tells a chair from a room spot, and who has either", () => {
    const places = new Map([[placeKey("subagent_a", "library"), 1]]);
    expect(placeKey("subagent_a")).toBe("subagent_a");
    expect(remembersAnything(places, "subagent_a")).toBe(true);
    expect(remembersAnything(places, "subagent")).toBe(false);
  });

  it("keeps the places for the tab, across a reload", () => {
    const store = new Map<string, string>();
    Object.assign(globalThis, {
      sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    });
    const places = rememberedPlaces();
    rememberPlace(places, "subagent_a", 2);
    rememberPlace(places, "colleague:s2@library", 0);

    expect([...rememberedPlaces()]).toEqual([
      ["subagent_a", 2],
      ["colleague:s2@library", 0],
    ]);
  });

  it("forgets the oldest past 128 and works without storage", () => {
    const places = new Map<string, number>();
    for (let i = 0; i < 130; i++) rememberPlace(places, `p${i}`, i % 11);
    expect(places.size).toBe(128);
    expect(places.has("p0")).toBe(false);
    expect(rememberedPlaces().size).toBe(0);
  });
});
