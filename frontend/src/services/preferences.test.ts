import { describe, expect, it, vi } from "vitest";
import { startPageOptions } from "../appPreferences.ts";
import { createFetchRouter } from "../test/fetch-router.ts";
import { loadPreferences, savePreferences } from "./preferences.ts";

describe("Application preferences API", () => {
  it("loads and saves only the installation preference using cancelable same-origin requests", async () => {
    const router = createFetchRouter();
    vi.stubGlobal("fetch", router.fetch);
    const controller = new AbortController();
    for (const option of startPageOptions) {
      const preferences = { startPage: option.value };
      router.json("GET", "/api/preferences", preferences);
      router.json("PUT", "/api/preferences", async (request: Request) => {
        expect(await request.json()).toEqual(preferences);
        return Response.json(preferences);
      });
      await expect(loadPreferences(controller.signal)).resolves.toEqual(
        preferences,
      );
      await expect(savePreferences(preferences, controller.signal)).resolves
        .toEqual(preferences);
    }
    expect(router.fetch).toHaveBeenLastCalledWith(
      "/api/preferences",
      expect.objectContaining({ method: "PUT", signal: controller.signal }),
    );
  });

  it("rejects missing and invalid start pages rather than trusting arbitrary server data", async () => {
    const router = createFetchRouter();
    vi.stubGlobal("fetch", router.fetch);
    for (
      const value of [null, [], {}, { startPage: null }, { startPage: 1 }, {
        startPage: "settings",
      }, { startPage: "#library/list" }]
    ) {
      router.json("GET", "/api/preferences", value);
      await expect(loadPreferences(new AbortController().signal)).rejects
        .toThrow("response was invalid");
    }
  });

  it("reports API and non-JSON failures without claiming a successful save", async () => {
    const router = createFetchRouter();
    vi.stubGlobal("fetch", router.fetch);
    router.json("PUT", "/api/preferences", {
      error: "could not save application preferences",
    }, 500);
    await expect(
      savePreferences({ startPage: "library" }, new AbortController().signal),
    ).rejects.toThrow("could not save application preferences");
    router.json(
      "GET",
      "/api/preferences",
      () => new Response("Unavailable", { status: 503 }),
    );
    await expect(loadPreferences(new AbortController().signal)).rejects.toThrow(
      "Please try again",
    );
  });
});
