import { afterEach, describe, expect, it, vi } from "vitest";
import { readLeads } from "@/hooks/useFloorColleagues";

const snapshot = (text: string | null): string =>
  JSON.stringify({
    type: "state_update",
    state: {
      entries: [
        {
          sessionId: "s2",
          bucket: "working",
          state: "working",
          activity: "reading",
          bubble: text ? { type: "thought", text, icon: "📖" } : null,
          turnActive: true,
        },
      ],
    },
  });

describe("readLeads", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps a bubble's time while it stays the same", () => {
    const at = vi.spyOn(Date, "now").mockReturnValue(1000);
    const first = readLeads(snapshot("src/auth.py"), new Map());
    expect(first?.get("s2")?.bubbleAt).toBe(1000);
    expect(first?.get("s2")?.entry.activity).toBe("reading");

    at.mockReturnValue(5000);
    const same = readLeads(snapshot("src/auth.py"), first ?? new Map());
    expect(same?.get("s2")?.bubbleAt).toBe(1000);
    const changed = readLeads(snapshot("src/db.py"), same ?? new Map());
    expect(changed?.get("s2")?.bubbleAt).toBe(5000);
    const quiet = readLeads(snapshot(null), changed ?? new Map());
    expect(quiet?.get("s2")?.bubbleAt).toBeNull();
  });

  it("ignores anything but an overview snapshot", () => {
    expect(readLeads("not json", new Map())).toBeNull();
    expect(readLeads(JSON.stringify({ type: "event" }), new Map())).toBeNull();
  });
});
