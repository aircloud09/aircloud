"use client";

/**
 * The isometric office (docs/plan/spec.md "화면 재설계"), the main page. The
 * button by 「LIVE」 opens settings.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Settings, Users } from "lucide-react";
import { AgentLogo } from "@/components/iso/AgentLogo";
import { IsoFloorGuide } from "@/components/iso/IsoFloorGuide";
import { IsoOffice } from "@/components/iso/IsoOffice";
import { IsoSidePanel } from "@/components/iso/IsoSidePanel";
import SettingsModal from "@/components/overlay/SettingsModal";
import { useCodingAgentName } from "@/hooks/useCodingAgentName";
import { useFloorColleagues } from "@/hooks/useFloorColleagues";
import { useNow } from "@/hooks/useNow";
import { useSessions } from "@/hooks/useSessions";
import { useSessionSwitch } from "@/hooks/useSessionSwitch";
import { useTranslation } from "@/hooks/useTranslation";
import { useWebSocketEvents } from "@/hooks/useWebSocketEvents";
import {
  selectBoss,
  selectCodingAgent,
  selectIsConnected,
  useGameStore,
} from "@/stores/gameStore";
import {
  selectShowFloorColleagues,
  selectTheme,
  usePreferencesStore,
} from "@/stores/preferencesStore";
import {
  buildFloors,
  floorColleagues,
  floorOfSession,
  sessionTitle,
} from "@/systems/floors";
import { initApiKeyFromBrowser } from "@/utils/api";
import { DARK_CLASS } from "@/utils/theme";

/** How long the 「▲ 3F」 lamp shows while the office changes floors (globals.css). */
const ELEVATOR_LAMP_MS = 1600;

const toolButton =
  "flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200";

export default function IsoOfficePage(): React.ReactNode {
  const { t } = useTranslation();
  // Status toasts are not shown on this page yet.
  const showStatus = useCallback(() => undefined, []);
  const { sessions, sessionsLoading, sessionId, setSessionId, fetchSessions } =
    useSessions(showStatus);
  const { handleSessionSelect } = useSessionSwitch({
    sessionId,
    setSessionId,
    fetchSessions,
    showStatus,
  });
  useWebSocketEvents({ sessionId });

  const loadPreferences = usePreferencesStore((s) => s.loadPreferences);
  useEffect(() => {
    initApiKeyFromBrowser();
    loadPreferences();
  }, [loadPreferences]);

  const theme = usePreferencesStore(selectTheme);
  useEffect(() => {
    document.documentElement.classList.toggle(DARK_CLASS, theme === "dark");
  }, [theme]);

  const isConnected = useGameStore(selectIsConnected);
  const codingAgent = useGameStore(selectCodingAgent);
  const boss = useGameStore(selectBoss);
  const session = sessions.find((s) => s.id === sessionId);
  const now = useNow(15_000);
  const floors = useMemo(() => buildFloors(sessions, now), [sessions, now]);
  const floor = floorOfSession(floors, sessionId);
  // Other sessions working on this floor send their lead agent in too,
  // unless the office is set to show only the chosen session.
  const together = usePreferencesStore(selectShowFloorColleagues);
  const colleagueSessions = useMemo(
    () => (together ? floorColleagues(floor, sessionId, now) : []),
    [together, floor, sessionId, now],
  );
  const leadName = useCodingAgentName();
  const colleagues = useFloorColleagues(colleagueSessions, leadName);
  const title =
    (session && sessionTitle(session)) ||
    boss.currentTask ||
    session?.id.slice(0, 8) ||
    "";

  // Moving to another floor lights 「▲ 3F」 (「▼」 going down) for a moment.
  const [lamp, setLamp] = useState<{ key: number; text: string } | null>(null);
  const goToSession = (id: string): void => {
    const from = floorOfSession(floors, sessionId);
    const to = floorOfSession(floors, id);
    if (from && to && from.number !== to.number) {
      const arrow = to.number > from.number ? "▲" : "▼";
      setLamp((previous) => ({
        key: (previous?.key ?? 0) + 1,
        text: `${arrow} ${to.number}F`,
      }));
    }
    void handleSessionSelect(id);
  };
  useEffect(() => {
    if (!lamp) return;
    const timer = window.setTimeout(() => setLamp(null), ELEVATOR_LAMP_MS);
    return () => window.clearTimeout(timer);
  }, [lamp]);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "connect">(
    "general",
  );
  const openSettings = (tab: "general" | "connect"): void => {
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  };

  // Below 1024px both columns are hidden; buttons open them as sheets.
  const [sheet, setSheet] = useState<"guide" | "panel" | null>(null);
  useEffect(() => {
    if (!sheet) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSheet(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sheet]);

  return (
    <main
      className="flex h-dvh w-full overflow-hidden bg-gradient-to-b from-[#f5f7fa] to-[#e8ecf2] text-slate-800 dark:from-[#151b27] dark:to-[#0d111a] dark:text-slate-100"
      style={{
        fontFamily:
          '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif',
      }}
    >
      <IsoFloorGuide
        floors={floors}
        sessionId={sessionId}
        now={now}
        onSelectSession={goToSession}
        className="hidden w-[184px] shrink-0 flex-col gap-2 py-3 pl-3 lg:flex"
      />
      {sheet === "guide" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="floor guide"
          className="fixed inset-0 z-40 flex lg:hidden"
        >
          <IsoFloorGuide
            floors={floors}
            sessionId={sessionId}
            now={now}
            onSelectSession={(id) => {
              setSheet(null);
              goToSession(id);
            }}
            className="flex h-full w-[260px] max-w-[85vw] flex-col gap-2 bg-[#f5f7fa] p-3 shadow-xl dark:bg-[#151b27]"
          />
          <button
            type="button"
            aria-label="close floor guide"
            onClick={() => setSheet(null)}
            className="flex-1 bg-slate-900/30 dark:bg-black/50"
          />
        </div>
      )}
      <div className="relative min-w-0 flex-1">
        <IsoOffice colleagues={colleagues} />

        {lamp && (
          <div
            key={lamp.key}
            role="status"
            className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 lg:top-5"
          >
            <div className="animate-elevator rounded-xl border-2 border-slate-700 bg-slate-900/95 px-5 py-2 font-mono text-2xl font-bold tracking-[0.2em] text-amber-300 shadow-lg [text-shadow:0_0_8px_rgba(252,211,77,0.7)] motion-reduce:animate-none">
              {lamp.text}
            </div>
          </div>
        )}

        {/* An empty office points at the connect tab: nothing is wired up yet. */}
        {!sessionsLoading && sessions.length === 0 && (
          <div className="absolute left-4 top-4 flex max-w-[min(60%,calc(100%_-_13rem))] items-center gap-3 rounded-xl border border-slate-200/80 bg-white/95 py-2 pl-3 pr-2 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/90">
            <p className="hidden min-w-0 truncate text-xs text-slate-500 sm:block dark:text-slate-400">
              {t("iso.connect.empty")}
            </p>
            <button
              type="button"
              onClick={() => openSettings("connect")}
              className="shrink-0 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {t("iso.connect.cta")}
            </button>
          </div>
        )}

        {session && (
          <header className="absolute left-4 top-4 flex max-w-[min(60%,calc(100%_-_13rem))] items-center gap-3 rounded-xl border border-slate-200/80 bg-white/95 py-2 pl-2 pr-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/90">
            <AgentLogo codingAgent={codingAgent ?? session.codingAgent} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {floor && (
                  <span className="rounded-md bg-slate-900 px-1.5 py-0.5 text-[11px] font-bold text-white dark:bg-slate-100 dark:text-slate-900">
                    {floor.number}F
                  </span>
                )}
                <span className="truncate text-sm font-bold">
                  {floor?.name ?? session.projectName}
                </span>
              </div>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {title}
              </p>
            </div>
          </header>
        )}

        <div className="absolute right-4 top-4 flex items-center gap-1.5">
          <button
            type="button"
            aria-label="floor guide"
            title={t("iso.floor.title")}
            onClick={() => setSheet("guide")}
            className={`${toolButton} lg:hidden`}
          >
            <Building2 size={14} />
          </button>
          <button
            type="button"
            aria-label="people"
            title={t("iso.panel.people")}
            onClick={() => setSheet("panel")}
            className={`${toolButton} lg:hidden`}
          >
            <Users size={14} />
          </button>
          <button
            type="button"
            aria-label="settings"
            title={t("header.settings")}
            onClick={() => openSettings("general")}
            className={toolButton}
          >
            <Settings size={14} />
          </button>
          <div
            className={`flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold shadow-sm dark:border-slate-700 dark:bg-slate-900 ${
              isConnected
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-slate-400"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}
            />
            {/* Phones keep just the dot: the top row is shared with the header. */}
            <span className="sr-only sm:not-sr-only">
              {isConnected ? t("iso.live") : t("iso.offline")}
            </span>
          </div>
        </div>
      </div>
      <IsoSidePanel
        session={session}
        colleagues={colleagues}
        className="hidden w-[240px] shrink-0 flex-col gap-2 py-3 pr-3 lg:flex"
      />
      {sheet === "panel" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="people"
          className="fixed inset-0 z-40 flex lg:hidden"
        >
          <button
            type="button"
            aria-label="close people"
            onClick={() => setSheet(null)}
            className="flex-1 bg-slate-900/30 dark:bg-black/50"
          />
          <IsoSidePanel
            session={session}
            colleagues={colleagues}
            className="flex h-full w-[280px] max-w-[85vw] flex-col gap-2 overflow-y-auto bg-[#f5f7fa] p-3 shadow-xl dark:bg-[#151b27]"
          />
        </div>
      )}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        initialTab={settingsTab}
      />
    </main>
  );
}
