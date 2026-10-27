"use client";

import { useCallback, useEffect, useState } from "react";
import { AgentLogo } from "@/components/iso/AgentLogo";
import { useTranslation, type TranslationKey } from "@/hooks/useTranslation";
import { apiFetch } from "@/utils/api";

/** One coding agent's connection, as `GET /api/v1/hooks` reports it. */
interface AgentHookStatus {
  agent: string;
  connected: boolean;
  events: string[];
  tool_found: boolean;
  cli: string;
  cli_found: boolean;
  settings_path: string;
}

interface AgentHooksOverview {
  available: boolean;
  reason: string | null;
  agents: AgentHookStatus[];
}

interface AgentHookRun {
  ok: boolean;
  command: string;
  output: string;
  status: AgentHookStatus;
}

type HookAction = "install" | "remove";

/** What the last button press on an agent did. */
type RunNote =
  | { kind: "ran"; ok: boolean; command: string; output: string }
  | { kind: "error"; message: TranslationKey };

/** Product names: each row names the tool a user installs. */
const AGENT_PRODUCTS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex CLI",
  "gemini-cli": "Gemini CLI",
};

/** What to do after connecting, per agent. */
const AFTER_CONNECT: Record<string, TranslationKey> = {
  "claude-code": "settings.connect.afterClaude",
  codex: "settings.connect.afterCodex",
  "gemini-cli": "settings.connect.afterGemini",
};

/** Label of the connect button: running, reconnect or connect. */
function connectLabel(connected: boolean, isRunning: boolean): TranslationKey {
  if (isRunning) return "settings.connect.running";
  return connected ? "settings.connect.reconnect" : "settings.connect.connect";
}

const button =
  "px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";

/**
 * Connects coding agents to the office: each button runs the same install
 * command as `make hooks-install` (or its Codex and Gemini twins) through the
 * backend. The backend trusts this page by its origin, so no launch token is
 * needed; it asks for one only when it refuses (an explicit API key, say).
 */
export function ConnectTab(): React.ReactNode {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<AgentHooksOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [running, setRunning] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, RunNote>>({});
  const [tokenRefused, setTokenRefused] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await apiFetch("/api/v1/hooks");
      if (!res.ok) throw new Error(String(res.status));
      setOverview((await res.json()) as AgentHooksOverview);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  // Fetch on mount. Deferred by a tick so its state updates do not render
  // synchronously inside the effect (react-hooks/set-state-in-effect).
  useEffect(() => {
    const timeout = setTimeout(() => void load(), 0);
    return () => clearTimeout(timeout);
  }, [load]);

  const run = async (agent: string, action: HookAction): Promise<void> => {
    setRunning(agent);
    try {
      const res = await apiFetch(`/api/v1/hooks/${agent}/${action}`, {
        method: "POST",
      });
      if (res.status === 401 || res.status === 403) {
        setTokenRefused(true);
        return;
      }
      if (res.status === 409) {
        const { detail } = (await res.json()) as { detail?: string };
        if (detail === "busy") {
          setNotes((n) => ({
            ...n,
            [agent]: { kind: "error", message: "settings.connect.busy" },
          }));
        } else {
          await load();
        }
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const result = (await res.json()) as AgentHookRun;
      setNotes((n) => ({
        ...n,
        [agent]: {
          kind: "ran",
          ok: result.ok,
          command: result.command,
          output: result.output,
        },
      }));
      setOverview((current) =>
        current
          ? {
              ...current,
              agents: current.agents.map((a) =>
                a.agent === agent ? result.status : a,
              ),
            }
          : current,
      );
    } catch {
      setNotes((n) => ({
        ...n,
        [agent]: { kind: "error", message: "settings.connect.loadFailed" },
      }));
    } finally {
      setRunning(null);
    }
  };

  if (loadFailed) {
    return (
      <p className="text-sm text-rose-600 dark:text-rose-400">
        {t("settings.connect.loadFailed")}
      </p>
    );
  }
  if (!overview) return null;

  const blocked = !overview.available || tokenRefused || running !== null;

  return (
    <div className="space-y-4">
      <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">
        {t("settings.connect.intro")}
      </p>

      {!overview.available && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          {overview.reason === "not_local"
            ? t("settings.connect.notLocal")
            : t("settings.connect.cannotRun", {
                reason: overview.reason ?? "",
              })}
        </p>
      )}
      {overview.available && tokenRefused && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          {t("settings.connect.needToken")}
        </p>
      )}

      <ul className="space-y-3">
        {overview.agents.map((status) => {
          const note = notes[status.agent];
          const isRunning = running === status.agent;
          return (
            <li
              key={status.agent}
              className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-center gap-3">
                <AgentLogo codingAgent={status.agent} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
                    {AGENT_PRODUCTS[status.agent] ?? status.agent}
                  </p>
                  <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {status.settings_path}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    status.connected
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {status.connected
                    ? t("settings.connect.connected")
                    : t("settings.connect.notConnected")}
                </span>
              </div>

              {!status.cli_found && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {t("settings.connect.cliMissing", {
                    cli: status.cli,
                  })}
                </p>
              )}
              {status.connected && !status.tool_found && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  {t("settings.connect.toolMissing")}
                </p>
              )}
              {status.connected && AFTER_CONNECT[status.agent] && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {t(AFTER_CONNECT[status.agent])}
                </p>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => void run(status.agent, "install")}
                  className={`${button} border-slate-900 bg-slate-900 text-white enabled:hover:bg-slate-700 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900 dark:enabled:hover:bg-white`}
                >
                  {t(connectLabel(status.connected, isRunning))}
                </button>
                {status.connected && (
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => void run(status.agent, "remove")}
                    className={`${button} border-slate-200 bg-white text-slate-600 enabled:hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:enabled:hover:bg-slate-800`}
                  >
                    {t("settings.connect.disconnect")}
                  </button>
                )}
              </div>

              {note?.kind === "error" && (
                <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
                  {t(note.message)}
                </p>
              )}
              {note?.kind === "ran" && (
                <div className="mt-2">
                  <p
                    role="status"
                    className={`text-xs ${note.ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600 dark:text-rose-400"}`}
                  >
                    {note.ok
                      ? t("settings.connect.done")
                      : t("settings.connect.failed")}
                  </p>
                  <details className="mt-1" open={!note.ok}>
                    <summary className="cursor-pointer text-[11px] text-slate-500 dark:text-slate-400">
                      {t("settings.connect.output", { command: note.command })}
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                      {note.output}
                    </pre>
                  </details>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
