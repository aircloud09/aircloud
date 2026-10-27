/**
 * Projects as floors of a building, for the floor guide (docs/plan/spec.md
 * "화면 재설계"): 1F is the project seen first, and each floor's sessions are
 * its shops.
 */

import type { Session } from "@/hooks/useSessions";

/** An open session counts as working now while its events are this recent. */
export const ACTIVE_NOW_MS = 5 * 60 * 1000;
/** Floors quiet for longer than this fold under 「오래 쉰 층 N개 더 보기」. */
export const IDLE_FLOOR_MS = 60 * 60 * 1000;
/**
 * At most this many other sessions send their lead agent into the office:
 * the dev room has eleven free chairs and subagents need the rest.
 */
export const MAX_COLLEAGUES = 5;

export interface Floor {
  /** 1-based floor number; 1F is the project whose first session is oldest. */
  number: number;
  projectKey: string;
  name: string;
  /** Newest first. */
  sessions: Session[];
  /** Whether one of its sessions is working now. */
  active: boolean;
  /** When its newest session last changed, in ms. */
  updatedAt: number;
}

/** Whether a session is open, in the middle of a turn and has just sent events. */
export function isActiveNow(session: Session, now: number): boolean {
  return (
    session.status === "active" &&
    !session.idle &&
    now - Date.parse(session.updatedAt) < ACTIVE_NOW_MS
  );
}

/** What a session is called: its own name, else its first prompt. */
export function sessionTitle(session: Session): string | null {
  return session.label || session.title || null;
}

function projectKey(session: Session): string {
  return session.projectRoot || session.projectName || session.id;
}

function projectName(session: Session): string {
  if (session.projectName) return session.projectName;
  if (session.projectRoot)
    return session.projectRoot.split("/").filter(Boolean).pop() ?? "";
  return session.id.slice(0, 8);
}

/**
 * The listed sessions plus the one being shown when the list leaves it out:
 * the backend drops sessions ended by `/clear` or ended with nothing in them,
 * and the floor guide still shows the session the office is on, as ended.
 */
export function keepShownSession(
  listed: Session[],
  previous: Session[],
  shownId: string,
): Session[] {
  if (!shownId || listed.some((s) => s.id === shownId)) return listed;
  const shown = previous.find((s) => s.id === shownId);
  return shown ? [...listed, { ...shown, status: "completed" }] : listed;
}

/** Group sessions into floors, listed top floor first like a building directory. */
export function buildFloors(sessions: Session[], now = Date.now()): Floor[] {
  const byProject = new Map<string, Session[]>();
  for (const session of sessions) {
    const key = projectKey(session);
    byProject.set(key, [...(byProject.get(key) ?? []), session]);
  }
  const firstSeen = (list: Session[]): number =>
    Math.min(...list.map((s) => Date.parse(s.createdAt)));
  const ordered = [...byProject.entries()].sort(
    ([, a], [, b]) => firstSeen(a) - firstSeen(b),
  );
  return ordered
    .map(([key, list], index): Floor => {
      const newestFirst = [...list].sort(
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
      return {
        number: index + 1,
        projectKey: key,
        name: projectName(newestFirst[0]),
        sessions: newestFirst,
        active: list.some((s) => isActiveNow(s, now)),
        updatedAt: Date.parse(newestFirst[0].updatedAt),
      };
    })
    .reverse();
}

/**
 * The other sessions on a floor that are working now, newest first: their
 * lead agents work in the office beside the session shown.
 */
export function floorColleagues(
  floor: Floor | undefined,
  sessionId: string | null,
  now: number,
): Session[] {
  if (!floor) return [];
  return floor.sessions
    .filter((session) => session.id !== sessionId && isActiveNow(session, now))
    .slice(0, MAX_COLLEAGUES);
}

/** The floor a session belongs to. */
export function floorOfSession(
  floors: Floor[],
  sessionId: string,
): Floor | undefined {
  return floors.find((floor) => floor.sessions.some((s) => s.id === sessionId));
}

/**
 * The floors the guide shows at first (the one being viewed, busy ones and
 * ones used within the hour) and the quiet rest, both top floor first.
 */
export function splitFloors(
  floors: Floor[],
  currentKey: string | undefined,
  now: number,
): { awake: Floor[]; idle: Floor[] } {
  const awake: Floor[] = [];
  const idle: Floor[] = [];
  for (const floor of floors) {
    const isAwake =
      floor.projectKey === currentKey ||
      floor.active ||
      now - floor.updatedAt < IDLE_FLOOR_MS;
    (isAwake ? awake : idle).push(floor);
  }
  return { awake, idle };
}
