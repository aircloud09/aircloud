"use client";

import { useEffect, useMemo, useState } from "react";
import { codingAgentName } from "@/constants/codingAgents";
import type { Session } from "@/hooks/useSessions";
import { sessionTitle } from "@/systems/floors";
import { isQuietTurn, type Colleague } from "@/systems/officePeople";
import type { BubbleContent, OverviewEntry } from "@/types";
import { WS_BASE } from "@/utils/api";

/** How long to wait before reconnecting a dropped overview socket (ms). */
const RECONNECT_MS = 3000;

/** A live session's lead agent, and when its bubble last changed (Date.now ms). */
interface LiveLead {
  entry: OverviewEntry;
  bubbleAt: number | null;
}

const sameBubble = (
  a: BubbleContent | null | undefined,
  b: BubbleContent | null | undefined,
): boolean =>
  (a?.type ?? null) === (b?.type ?? null) &&
  (a?.text ?? null) === (b?.text ?? null) &&
  (a?.icon ?? null) === (b?.icon ?? null);

/**
 * Read the overview snapshot in a socket message, keeping each lead agent's
 * bubble time while its bubble stays the same.
 */
export function readLeads(
  raw: string,
  previous: Map<string, LiveLead>,
): Map<string, LiveLead> | null {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return null;
  }
  const { type, state } = (message ?? {}) as {
    type?: string;
    state?: { entries?: OverviewEntry[] };
  };
  if (type !== "state_update" || !Array.isArray(state?.entries)) return null;
  const leads = new Map<string, LiveLead>();
  const now = Date.now();
  for (const entry of state.entries) {
    const before = previous.get(entry.sessionId);
    const kept = before && sameBubble(before.entry.bubble, entry.bubble);
    leads.set(entry.sessionId, {
      entry,
      bubbleAt: entry.bubble ? (kept ? before.bubbleAt : now) : null,
    });
  }
  return leads;
}

/**
 * The lead agents of ``sessions`` as colleagues for the office, live from
 * `/ws/overview` (one socket covers every session). The socket stays closed
 * while there is nobody to show.
 */
export function useFloorColleagues(
  sessions: Session[],
  fallbackName: string,
): Colleague[] {
  // Null until the overview socket's first message: no lead is known yet.
  const [leads, setLeads] = useState<Map<string, LiveLead> | null>(null);
  const wanted = sessions.length > 0;

  useEffect(() => {
    if (!wanted) return;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const connect = (): void => {
      socket = new WebSocket(`${WS_BASE}/ws/overview`);
      socket.onmessage = (event: MessageEvent<string>) => {
        setLeads(
          (previous) =>
            readLeads(event.data, previous ?? new Map()) ?? previous,
        );
      };
      socket.onclose = () => {
        if (!stopped) retry = setTimeout(connect, RECONNECT_MS);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      socket?.close();
      // What the closed socket last said goes stale: a colleague shown again
      // later waits for the next overview instead of starting from it.
      setLeads(null);
    };
  }, [wanted]);

  return useMemo(
    () =>
      // Colleagues wait for the overview: drawn before it, they would sit idle
      // at a desk and then walk to the rooms they are working in. A session
      // the overview leaves out (not in the backend's memory, as right after
      // it restarts) still shows, at its desk.
      (leads === null ? [] : sessions).map((session): Colleague => {
        const lead = leads?.get(session.id);
        const boss = lead?.entry;
        return {
          sessionId: session.id,
          agentName: codingAgentName(session.codingAgent) ?? fallbackName,
          title: sessionTitle(session) ?? session.id.slice(0, 8),
          activity: boss?.activity ?? null,
          stuck: boss?.stuck ?? null,
          bubble: boss?.bubble ?? null,
          bubbleAt: lead?.bubbleAt ?? null,
          since: boss?.lastEventAt ? Date.parse(boss.lastEventAt) : null,
          thinking: boss
            ? isQuietTurn({
                state: boss.state,
                activity: boss.activity,
                stuck: boss.stuck,
                turnActive: boss.turnActive,
              })
            : false,
        };
      }),
    [sessions, leads, fallbackName],
  );
}
