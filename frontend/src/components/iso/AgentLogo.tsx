/** Square mark of the coding agent running the session, as in the reference header. */

const LOGOS: Record<string, { mark: string; className: string }> = {
  "claude-code": { mark: "✳", className: "bg-[#d97757] text-white text-lg" },
  opencode: {
    mark: "OC",
    className:
      "bg-slate-900 text-white text-[10px] font-bold dark:ring-1 dark:ring-inset dark:ring-white/20",
  },
  "gemini-cli": {
    mark: "✦",
    className:
      "bg-gradient-to-br from-sky-500 to-violet-500 text-white text-base",
  },
  codex: {
    mark: "◎",
    className:
      "bg-black text-white text-base dark:ring-1 dark:ring-inset dark:ring-white/20",
  },
};

export function AgentLogo({
  codingAgent,
}: {
  codingAgent: string | null;
}): React.ReactNode {
  const logo = (codingAgent && LOGOS[codingAgent]) || {
    mark: "A",
    className: "bg-slate-500 text-white text-xs font-bold",
  };
  return (
    <span
      aria-hidden="true"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg leading-none ${logo.className}`}
    >
      {logo.mark}
    </span>
  );
}
