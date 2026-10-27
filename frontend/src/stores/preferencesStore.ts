"use client";

import { create } from "zustand";
import { isLocale, type Locale } from "@/i18n";
import { apiFetch } from "@/utils/api";
import {
  DEFAULT_THEME,
  isTheme,
  readStoredTheme,
  storeTheme,
  type Theme,
} from "@/utils/theme";

// ============================================================================
// TYPES
// ============================================================================

export interface PreferencesState {
  autoFollowNewSessions: boolean;
  /** The office also shows the floor's other working sessions (off: only the chosen one). */
  showFloorColleagues: boolean;
  language: Locale;
  theme: Theme;
  isLoaded: boolean;

  // Actions
  loadPreferences: () => Promise<void>;
  setAutoFollowNewSessions: (enabled: boolean) => Promise<void>;
  setShowFloorColleagues: (enabled: boolean) => Promise<void>;
  setLanguage: (language: Locale) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const PREFS_PATH = "/api/v1/preferences";

const DEFAULT_AUTO_FOLLOW_NEW_SESSIONS = true;
const DEFAULT_SHOW_FLOOR_COLLEAGUES = true;
const DEFAULT_LANGUAGE: Locale = "en";

// ============================================================================
// API HELPERS
// ============================================================================

async function fetchPreferences(): Promise<Record<string, string>> {
  try {
    const res = await apiFetch(PREFS_PATH);
    if (res.ok) {
      return (await res.json()) as Record<string, string>;
    }
  } catch (err) {
    console.warn("[preferences] Failed to fetch:", err);
  }
  return {};
}

async function setPreference(key: string, value: string): Promise<void> {
  try {
    await apiFetch(`${PREFS_PATH}/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
  } catch (err) {
    console.warn(`[preferences] Failed to save "${key}":`, err);
  }
}

// ============================================================================
// STORE
// ============================================================================

export const usePreferencesStore = create<PreferencesState>()((set, get) => ({
  autoFollowNewSessions: DEFAULT_AUTO_FOLLOW_NEW_SESSIONS,
  showFloorColleagues: DEFAULT_SHOW_FLOOR_COLLEAGUES,
  language: DEFAULT_LANGUAGE,
  // This browser's last theme until the saved preference arrives.
  theme: readStoredTheme() ?? DEFAULT_THEME,
  isLoaded: false,

  loadPreferences: async () => {
    const prefs = await fetchPreferences();

    const autoFollowRaw = prefs.auto_follow_new_sessions;
    const autoFollowNewSessions =
      autoFollowRaw === undefined
        ? DEFAULT_AUTO_FOLLOW_NEW_SESSIONS
        : autoFollowRaw === "true";
    const colleaguesRaw = prefs.show_floor_colleagues;
    const showFloorColleagues =
      colleaguesRaw === undefined
        ? DEFAULT_SHOW_FLOOR_COLLEAGUES
        : colleaguesRaw === "true";
    const language = prefs.language || DEFAULT_LANGUAGE;
    // No saved theme yet: keep the one this browser used.
    const theme = isTheme(prefs.theme) ? prefs.theme : get().theme;
    storeTheme(theme);

    set({
      autoFollowNewSessions,
      showFloorColleagues,
      language: isLocale(language) ? language : DEFAULT_LANGUAGE,
      theme,
      isLoaded: true,
    });
  },

  setAutoFollowNewSessions: async (enabled) => {
    set({ autoFollowNewSessions: enabled });
    await setPreference("auto_follow_new_sessions", String(enabled));
  },

  setShowFloorColleagues: async (enabled) => {
    set({ showFloorColleagues: enabled });
    await setPreference("show_floor_colleagues", String(enabled));
  },

  setLanguage: async (language) => {
    set({ language });
    await setPreference("language", language);
  },

  setTheme: async (theme) => {
    set({ theme });
    storeTheme(theme);
    await setPreference("theme", theme);
  },
}));

// ============================================================================
// SELECTORS
// ============================================================================

export const selectAutoFollowNewSessions = (state: PreferencesState) =>
  state.autoFollowNewSessions;
export const selectShowFloorColleagues = (state: PreferencesState) =>
  state.showFloorColleagues;
export const selectLanguage = (state: PreferencesState) => state.language;
export const selectTheme = (state: PreferencesState) => state.theme;
export const selectIsLoaded = (state: PreferencesState) => state.isLoaded;
