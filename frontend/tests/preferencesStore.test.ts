import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("@/utils/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const { usePreferencesStore } = await import("@/stores/preferencesStore");

const saved = (prefs: Record<string, string>): Response =>
  ({ ok: true, json: async () => prefs }) as Response;

describe("showFloorColleagues", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    usePreferencesStore.setState({ showFloorColleagues: true });
  });

  it("is on unless it was turned off", async () => {
    apiFetch.mockResolvedValueOnce(saved({}));
    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().showFloorColleagues).toBe(true);

    apiFetch.mockResolvedValueOnce(saved({ show_floor_colleagues: "false" }));
    await usePreferencesStore.getState().loadPreferences();
    expect(usePreferencesStore.getState().showFloorColleagues).toBe(false);
  });

  it("saves the choice", async () => {
    apiFetch.mockResolvedValueOnce(saved({}));
    await usePreferencesStore.getState().setShowFloorColleagues(false);
    expect(usePreferencesStore.getState().showFloorColleagues).toBe(false);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/preferences/show_floor_colleagues",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ value: "false" }),
      }),
    );
  });
});
