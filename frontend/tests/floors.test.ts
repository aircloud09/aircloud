import { describe, expect, it } from "vitest";
import type { Session } from "@/hooks/useSessions";
import {
  buildFloors,
  floorColleagues,
  floorOfSession,
  isActiveNow,
  keepShownSession,
  MAX_COLLEAGUES,
  sessionTitle,
  splitFloors,
} from "@/systems/floors";

function session(
  id: string,
  project: string,
  created: string,
  updated: string,
  status = "completed",
): Session {
  return {
    id,
    label: null,
    title: null,
    displayName: null,
    projectName: project,
    projectRoot: `/work/${project}`,
    createdAt: created,
    updatedAt: updated,
    status,
    eventCount: 1,
    codingAgent: null,
    idle: false,
  };
}

describe("buildFloors", () => {
  const sessions = [
    session("b1", "api", "2026-10-02T00:00:00Z", "2026-10-02T01:00:00Z"),
    session("a1", "shop", "2026-10-01T00:00:00Z", "2026-10-01T01:00:00Z"),
    session(
      "a2",
      "shop",
      "2026-10-03T00:00:00Z",
      "2026-10-03T05:00:00Z",
      "active",
    ),
  ];

  it("numbers floors by the project seen first and lists the top floor first", () => {
    const floors = buildFloors(sessions);
    expect(floors.map((f) => [f.number, f.name])).toEqual([
      [2, "api"],
      [1, "shop"],
    ]);
  });

  it("puts each floor's newest session first and marks busy floors", () => {
    const justAfter = Date.parse("2026-10-03T05:01:00Z");
    const shop = buildFloors(sessions, justAfter).find(
      (f) => f.name === "shop",
    );
    expect(shop?.sessions.map((s) => s.id)).toEqual(["a2", "a1"]);
    expect(shop?.active).toBe(true);
    expect(shop?.updatedAt).toBe(Date.parse("2026-10-03T05:00:00Z"));
    // An open session that has gone quiet is not working now.
    const later = Date.parse("2026-10-03T05:10:00Z");
    expect(
      buildFloors(sessions, later).find((f) => f.name === "shop")?.active,
    ).toBe(false);
  });

  it("finds a session's floor", () => {
    expect(floorOfSession(buildFloors(sessions), "b1")?.number).toBe(2);
    expect(floorOfSession(buildFloors(sessions), "missing")).toBeUndefined();
  });
});

describe("floorColleagues", () => {
  const now = Date.parse("2026-10-03T05:01:00Z");
  const working = (id: string, project: string, updated: string): Session =>
    session(id, project, "2026-10-03T00:00:00Z", updated, "active");

  it("brings in the other sessions working on the same floor, newest first", () => {
    const floors = buildFloors(
      [
        working("shown", "p", "2026-10-03T05:00:50Z"),
        working("older", "p", "2026-10-03T05:00:10Z"),
        working("newer", "p", "2026-10-03T05:00:40Z"),
        working("idle", "p", "2026-10-03T04:00:00Z"),
        session("done", "p", "2026-10-03T00:00:00Z", "2026-10-03T05:00:55Z"),
        working("elsewhere", "q", "2026-10-03T05:00:58Z"),
      ],
      now,
    );
    const floor = floorOfSession(floors, "shown");
    expect(floorColleagues(floor, "shown", now).map((s) => s.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("leaves the rest of the dev chairs to subagents", () => {
    const busy = Array.from({ length: 8 }, (_, i) =>
      working(`s${i}`, "p", `2026-10-03T05:00:${10 + i}Z`),
    );
    const floor = buildFloors(busy, now)[0];
    expect(floorColleagues(floor, "s7", now)).toHaveLength(MAX_COLLEAGUES);
    expect(floorColleagues(undefined, null, now)).toEqual([]);
  });
});

describe("isActiveNow", () => {
  const open = session(
    "s",
    "p",
    "2026-10-03T00:00:00Z",
    "2026-10-03T05:00:00Z",
    "active",
  );
  const at = (time: string): number => Date.parse(time);

  it("is an open session that sent events within five minutes", () => {
    expect(isActiveNow(open, at("2026-10-03T05:04:59Z"))).toBe(true);
    expect(isActiveNow(open, at("2026-10-03T05:05:00Z"))).toBe(false);
    expect(
      isActiveNow({ ...open, status: "completed" }, at("2026-10-03T05:00:30Z")),
    ).toBe(false);
  });

  it("is not a session whose turn has ended, however recent", () => {
    expect(
      isActiveNow({ ...open, idle: true }, at("2026-10-03T05:00:30Z")),
    ).toBe(false);
  });
});

describe("sessionTitle", () => {
  const base = session(
    "s",
    "p",
    "2026-10-03T00:00:00Z",
    "2026-10-03T00:00:00Z",
  );

  it("prefers the session's own name, then its first prompt", () => {
    expect(
      sessionTitle({ ...base, label: "Renamed", title: "Fix login" }),
    ).toBe("Renamed");
    expect(sessionTitle({ ...base, title: "Fix login" })).toBe("Fix login");
    expect(sessionTitle(base)).toBeNull();
  });
});

describe("splitFloors", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const list = [
    session("c1", "current", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"),
    session("r1", "recent", "2026-10-02T00:00:00Z", "2026-10-10T11:30:00Z"),
    session("o1", "old", "2026-10-03T00:00:00Z", "2026-10-09T00:00:00Z"),
    session(
      "b1",
      "busy",
      "2026-10-04T00:00:00Z",
      "2026-10-10T11:59:30Z",
      "active",
    ),
  ];

  it("shows the floor being viewed, busy floors and ones used within the hour", () => {
    const floors = buildFloors(list, now);
    const { awake, idle } = splitFloors(floors, "/work/current", now);
    expect(awake.map((f) => f.name)).toEqual(["busy", "recent", "current"]);
    expect(idle.map((f) => f.name)).toEqual(["old"]);
  });
});

describe("keepShownSession", () => {
  const shown = session(
    "s1",
    "app",
    "2026-10-01T00:00:00Z",
    "2026-10-10T11:59:00Z",
    "active",
  );
  const other = session(
    "s2",
    "app",
    "2026-10-02T00:00:00Z",
    "2026-10-10T12:00:00Z",
  );

  it("keeps the shown session, as ended, when the list leaves it out", () => {
    const listed = keepShownSession([other], [shown, other], "s1");
    expect(listed.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(listed[1].status).toBe("completed");
  });

  it("drops a session left out once it is no longer shown", () => {
    expect(keepShownSession([other], [shown, other], "s2")).toEqual([other]);
  });

  it("adds nothing it never saw", () => {
    expect(keepShownSession([other], [], "s1")).toEqual([other]);
  });
});
