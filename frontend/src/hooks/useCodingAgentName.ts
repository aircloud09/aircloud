"use client";

import { codingAgentName } from "@/constants/codingAgents";
import { useTranslation } from "@/hooks/useTranslation";
import { selectCodingAgent, useGameStore } from "@/stores/gameStore";

/** Name of the coding agent running the current session, for the boss's name tag. */
export function useCodingAgentName(): string {
  const { t } = useTranslation();
  const codingAgent = useGameStore(selectCodingAgent);
  return codingAgentName(codingAgent) ?? t("office.unknownAgent");
}
