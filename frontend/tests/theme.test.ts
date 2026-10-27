import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved: Record<string, string> = {};
const apiFetch = vi.fn();

vi.mock("../src/utils/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

function fakeStorage(): Storage {
  return {
    getItem: (key: string) => saved[key] ?? null,
    setItem: (key: string, value: string) => {
      saved[key] = value;
    },
    removeItem: (key: string) => {
      delete saved[key];
    },
    clear: () => undefined,
    key: () => null,
    length: 0,
  };
}

function preferencesResponse(prefs: Record<string, string>): Response {
  return { ok: true, json: async () => prefs } as Response;
}

beforeEach(() => {
  for (const key of Object.keys(saved)) delete saved[key];
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", fakeStorage());
  apiFetch.mockReset();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theme storage", () => {
  it("accepts only light and dark", async () => {
    const { isTheme } = await import("../src/utils/theme");
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });

  it("reads back the theme it stored and ignores anything else", async () => {
    const { readStoredTheme, storeTheme } = await import("../src/utils/theme");
    expect(readStoredTheme()).toBeNull();
    storeTheme("dark");
    expect(readStoredTheme()).toBe("dark");
    saved["agent-office-theme"] = "purple";
    expect(readStoredTheme()).toBeNull();
  });

  it("reads nothing when storage throws", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    const { readStoredTheme } = await import("../src/utils/theme");
    expect(readStoredTheme()).toBeNull();
  });

  it("puts the dark class on <html> before paint only for a stored dark theme", async () => {
    const { THEME_INIT_SCRIPT } = await import("../src/utils/theme");
    const run = (): string[] => {
      const classes: string[] = [];
      const document = {
        documentElement: { classList: { add: (c: string) => classes.push(c) } },
      };
      new Function("localStorage", "document", THEME_INIT_SCRIPT)(
        fakeStorage(),
        document,
      );
      return classes;
    };
    expect(run()).toEqual([]);
    saved["agent-office-theme"] = "light";
    expect(run()).toEqual([]);
    saved["agent-office-theme"] = "dark";
    expect(run()).toEqual(["dark"]);
  });
});

describe("theme preference", () => {
  it("starts from this browser's stored theme", async () => {
    saved["agent-office-theme"] = "dark";
    const { usePreferencesStore } =
      await import("../src/stores/preferencesStore");
    expect(usePreferencesStore.getState().theme).toBe("dark");
  });

  it("takes the saved preference and mirrors it in the browser", async () => {
    saved["agent-office-theme"] = "light";
    apiFetch.mockResolvedValue(preferencesResponse({ theme: "dark" }));
    const { usePreferencesStore } =
      await import("../src/stores/preferencesStore");
    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().theme).toBe("dark");
    expect(saved["agent-office-theme"]).toBe("dark");
  });

  it("keeps the browser's theme when none is saved or the value is unknown", async () => {
    saved["agent-office-theme"] = "dark";
    apiFetch.mockResolvedValue(preferencesResponse({ theme: "sepia" }));
    const { usePreferencesStore } =
      await import("../src/stores/preferencesStore");
    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().theme).toBe("dark");
  });

  it("saves a new theme to the backend and the browser", async () => {
    apiFetch.mockResolvedValue(preferencesResponse({}));
    const { usePreferencesStore } =
      await import("../src/stores/preferencesStore");
    await usePreferencesStore.getState().setTheme("dark");
    expect(usePreferencesStore.getState().theme).toBe("dark");
    expect(saved["agent-office-theme"]).toBe("dark");
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/preferences/theme",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ value: "dark" }),
      }),
    );
  });
});
