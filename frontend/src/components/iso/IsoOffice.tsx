"use client";

import { useEffect, useMemo, useRef } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useCodingAgentName } from "@/hooks/useCodingAgentName";
import { useTranslation } from "@/hooks/useTranslation";
import { agentMachineService } from "@/machines/agentMachineService";
import { selectShownSessionId, useGameStore } from "@/stores/gameStore";
import { selectTheme, usePreferencesStore } from "@/stores/preferencesStore";
import type { AgentPhase } from "@/stores/slices/types";
import {
  officePeople,
  type Colleague,
  type PeopleWords,
} from "@/systems/officePeople";
import { latestTodoNotes } from "@/systems/roomGimmicks";
import type { BubbleWords } from "./isoBubbles";
import { createIsoView, type IsoView } from "./isoView";

const ZOOM_STEP = 1.25;

/** Phases the 2D office walks a new subagent through on its way to a desk. */
const ARRIVAL_PHASES: ReadonlySet<AgentPhase> = new Set([
  "arriving",
  "in_arrival_queue",
  "walking_to_ready",
  "conversing",
  "walking_to_boss",
  "at_boss",
  "walking_to_desk",
]);

/**
 * Seat new subagents at once: the 2D office's arrival walk does not run on
 * this page, and a subagent only gets bubbles once it is at its desk.
 */
function seatNewcomers(): void {
  const store = useGameStore.getState();
  for (const [id, agent] of store.agents) {
    if (ARRIVAL_PHASES.has(agent.phase)) store.updateAgentPhase(id, "idle");
  }
}

/**
 * Show each person's latest bubble at once. The 2D office's bubble timer
 * does not run on this page, so queued bubbles are moved up here instead.
 */
function takeLatestBubbles(): void {
  const store = useGameStore.getState();
  for (let left = store.boss.bubble.queue.length; left > 0; left--) {
    store.advanceBubble("boss");
  }
  for (const [id, agent] of store.agents) {
    for (let left = agent.bubble.queue.length; left > 0; left--) {
      store.advanceBubble(id);
    }
  }
}
/** `next dev` puts its indicator in the bottom-left corner; keep the buttons above it. */
const CONTROLS_BOTTOM =
  process.env.NODE_ENV === "development" ? "bottom-16" : "bottom-4";

/**
 * The isometric office scene with its people, zoom buttons and control hint
 * (drag to pan, scroll to zoom, double-click to reset). ``colleagues`` are
 * the lead agents of other sessions working on the same floor.
 */
export function IsoOffice({
  colleagues,
}: {
  colleagues: Colleague[];
}): React.ReactNode {
  const { t } = useTranslation();
  const agentName = useCodingAgentName();
  const theme = usePreferencesStore(selectTheme);
  const eventLog = useGameStore((s) => s.eventLog);
  // The latest to-do list goes up on the whiteboard as sticky notes.
  const notes = useMemo(() => latestTodoNotes(eventLog), [eventLog]);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<IsoView | null>(null);
  /** The session snapshot the people on the floor were placed from. */
  const placedForRef = useRef<string | null>(null);
  const words = useMemo<PeopleWords>(
    () => ({
      agentName,
      me: t("iso.me"),
      generalType: t("iso.agentType.general"),
    }),
    [agentName, t],
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    // A subagent that rode the elevator away leaves the session's office too.
    const view = createIsoView(mount, (id) =>
      agentMachineService.dismissAgent(id),
    );
    viewRef.current = view;
    return () => {
      view.dispose();
      viewRef.current = null;
      placedForRef.current = null;
    };
  }, []);

  const bubbleWords = useMemo<BubbleWords>(
    () => ({
      thinking: t("iso.bubble.thinking"),
      thinkingFor: (seconds) => t("iso.bubble.thinkingFor", { seconds }),
      looking: t("iso.bubble.looking"),
      bye: t("iso.bubble.bye"),
      compacting: t("iso.bubble.compacting"),
    }),
    [t],
  );
  useEffect(() => {
    viewRef.current?.setBubbleWords(bubbleWords);
  }, [bubbleWords]);

  useEffect(() => {
    viewRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    viewRef.current?.setNotes(notes);
  }, [notes]);

  // Keep the people on the floor in step with the session.
  useEffect(() => {
    let showing = false;
    const show = (): void => {
      // Moving bubbles up changes the store and calls back in here.
      if (showing) return;
      // Nobody is placed until the shown session's snapshot is in: the office
      // stays empty instead of showing the last session's people or the
      // reset store's lone, idle Claude. A new snapshot places everyone
      // afresh: they start where it puts them (at work, on the sofa, in the
      // cafe) instead of walking there.
      const shown = selectShownSessionId(useGameStore.getState());
      if (shown !== placedForRef.current) {
        placedForRef.current = shown;
        viewRef.current?.clearPeople();
      }
      if (shown === null) return;
      showing = true;
      seatNewcomers();
      takeLatestBubbles();
      viewRef.current?.setPeople(
        officePeople(useGameStore.getState(), words, colleagues),
      );
      showing = false;
    };
    show();
    return useGameStore.subscribe(show);
  }, [words, colleagues]);

  const buttonClass =
    "flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800";

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="absolute inset-0" />
      <div
        className={`absolute left-4 flex flex-col gap-1.5 ${CONTROLS_BOTTOM}`}
      >
        <button
          type="button"
          className={buttonClass}
          aria-label={t("zoom.in")}
          onClick={() => viewRef.current?.zoomBy(ZOOM_STEP)}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={t("zoom.out")}
          onClick={() => viewRef.current?.zoomBy(1 / ZOOM_STEP)}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={t("zoom.reset")}
          onClick={() => viewRef.current?.resetView()}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-3 right-4 text-[11px] text-slate-400 dark:text-slate-500">
        {t("iso.controlsHint")}
      </p>
    </div>
  );
}
