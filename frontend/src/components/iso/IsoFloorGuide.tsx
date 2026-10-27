"use client";

/**
 * The left-hand 「층별 안내」 of the isometric office (docs/plan/spec.md
 * 「화면 재설계」, after the video): a card per floor (project) top floor
 * first, the floor being viewed open with 「최근 세션 자동으로 따라가기」 and
 * its sessions, and the quiet floors folded under 「오래 쉰 층 N개 더 보기」.
 * ``className`` places it: a column beside the office, or a sheet on phones.
 */

import { formatDistance } from "date-fns";
import { useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { dateFnsLocaleFor } from "@/i18n/dateLocale";
import {
  selectAutoFollowNewSessions,
  selectShowFloorColleagues,
  usePreferencesStore,
} from "@/stores/preferencesStore";
import {
  floorOfSession,
  isActiveNow,
  sessionTitle,
  splitFloors,
  type Floor,
} from "@/systems/floors";

/** Badge colours by floor, after the video: 1F blue, 2F teal, 3F orange, 4F pink. */
const FLOOR_TONES = [
  { soft: "#dfe7fa", strong: "#4972d4" },
  { soft: "#d7edeb", strong: "#449787" },
  { soft: "#fbe7cf", strong: "#dc7d00" },
  { soft: "#f8e1e9", strong: "#d6457a" },
] as const;

const toneOf = (floor: Floor): (typeof FLOOR_TONES)[number] =>
  FLOOR_TONES[(floor.number - 1) % FLOOR_TONES.length];

/** The session to open on a floor: one working now, else the newest. */
function entranceOf(floor: Floor, now: number): string {
  return (
    floor.sessions.find((session) => isActiveNow(session, now)) ??
    floor.sessions[0]
  ).id;
}

export function IsoFloorGuide({
  floors,
  sessionId,
  now,
  onSelectSession,
  className,
}: {
  floors: Floor[];
  sessionId: string;
  now: number;
  onSelectSession: (id: string) => void;
  className: string;
}): React.ReactNode {
  const { t, language } = useTranslation();
  const autoFollow = usePreferencesStore(selectAutoFollowNewSessions);
  const setAutoFollow = usePreferencesStore((s) => s.setAutoFollowNewSessions);
  const together = usePreferencesStore(selectShowFloorColleagues);
  const setTogether = usePreferencesStore((s) => s.setShowFloorColleagues);
  const [showIdle, setShowIdle] = useState(false);

  const current = floorOfSession(floors, sessionId);
  const { awake, idle } = splitFloors(floors, current?.projectKey, now);
  const shown = showIdle ? floors : awake;
  const locale = dateFnsLocaleFor(language);
  // The clock ticks every 15 s, so a session can have changed after it.
  const ago = (time: number): string =>
    formatDistance(Math.min(time, now), now, { addSuffix: true, locale });

  return (
    <aside className={className}>
      <header className="flex items-center justify-between gap-1 px-1">
        <h2 className="flex items-center gap-1 text-[13px] font-bold">
          <span aria-hidden="true">🏬</span>
          {t("iso.floor.title")}
        </h2>
        <span className="text-[8.5px] font-bold tracking-[0.14em] text-slate-400 dark:text-slate-500">
          {t("iso.floor.caption")}
        </span>
      </header>

      <div className="-mr-1 flex min-h-0 flex-col gap-2 overflow-y-auto pr-1">
        <ol className="flex flex-col gap-2">
          {shown.map((floor) => {
            const tone = toneOf(floor);
            const open = floor.projectKey === current?.projectKey;
            const summary = (
              <>
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold"
                  style={
                    open
                      ? { background: tone.strong, color: "#fff" }
                      : { background: tone.soft, color: tone.strong }
                  }
                >
                  {floor.number}F
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-bold">
                    {floor.name}
                  </span>
                  <span className="line-clamp-2 block text-[10px] leading-snug text-slate-400 dark:text-slate-500">
                    {t("iso.floor.sessions", { count: floor.sessions.length })}
                    {" · "}
                    {floor.active
                      ? t("iso.floor.activeNow")
                      : ago(floor.updatedAt)}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    floor.active
                      ? "bg-[#2ca056]"
                      : "bg-slate-300 dark:bg-slate-600"
                  }`}
                />
              </>
            );
            return (
              <li
                key={floor.projectKey}
                className={`overflow-hidden rounded-xl border bg-white/95 shadow-sm dark:bg-slate-900/90 ${
                  open
                    ? "border-[1.5px]"
                    : "border-slate-200/80 dark:border-slate-700/70"
                }`}
                style={open ? { borderColor: tone.strong } : undefined}
              >
                {open ? (
                  <div className="flex items-center gap-2 p-2">{summary}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectSession(entranceOf(floor, now))}
                    className="flex w-full items-center gap-2 p-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {summary}
                  </button>
                )}

                {open && (
                  <div className="border-t border-slate-100 px-1.5 pb-1.5 pt-1 dark:border-slate-800">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoFollow}
                      onClick={() => void setAutoFollow(!autoFollow)}
                      className={`mb-0.5 flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-[10.5px] hover:bg-slate-50 dark:hover:bg-slate-800 ${
                        autoFollow
                          ? "text-slate-600 dark:text-slate-300"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={autoFollow ? "" : "opacity-40 grayscale"}
                      >
                        🔄
                      </span>
                      {t("iso.floor.follow")}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={together}
                      onClick={() => void setTogether(!together)}
                      className={`mb-0.5 flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-[10.5px] hover:bg-slate-50 dark:hover:bg-slate-800 ${
                        together
                          ? "text-slate-600 dark:text-slate-300"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={together ? "" : "opacity-40 grayscale"}
                      >
                        👥
                      </span>
                      {t("iso.floor.together")}
                    </button>
                    <ul className="-mr-1 flex max-h-[42vh] flex-col overflow-y-auto pr-1">
                      {floor.sessions.map((session) => {
                        const here = session.id === sessionId;
                        const working = isActiveNow(session, now);
                        return (
                          <li key={session.id}>
                            <button
                              type="button"
                              aria-current={here ? "true" : undefined}
                              onClick={() => onSelectSession(session.id)}
                              className={`flex w-full items-center gap-1 rounded-md px-1 py-[3px] text-left text-[10.5px] ${
                                here
                                  ? "bg-[#fdf1e1] font-bold text-slate-800 dark:bg-amber-400/15 dark:text-amber-100"
                                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
                              }`}
                            >
                              <span className="min-w-0 flex-1 truncate">
                                {here && <span aria-hidden="true">📌 </span>}
                                {sessionTitle(session) ??
                                  t("iso.floor.untitled", {
                                    id: session.id.slice(0, 8),
                                  })}
                              </span>
                              <span
                                className={`shrink-0 text-[9.5px] ${
                                  working
                                    ? "font-semibold text-[#2ca056]"
                                    : "font-normal text-slate-400 dark:text-slate-500"
                                }`}
                              >
                                {working
                                  ? t("iso.floor.activeNow")
                                  : ago(Date.parse(session.updatedAt))}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {idle.length > 0 && (
          <button
            type="button"
            onClick={() => setShowIdle(!showIdle)}
            className="py-1 text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            {showIdle
              ? t("iso.floor.lessIdle")
              : t("iso.floor.moreIdle", { count: idle.length })}
          </button>
        )}
      </div>
    </aside>
  );
}
