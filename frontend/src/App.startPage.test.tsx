import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import type { StartPage } from "./appPreferences.ts";
import { disconnectedAniList, mediaItems } from "./test/fixtures.ts";
import { createFetchRouter } from "./test/fetch-router.ts";

function bootstrap(startPage: StartPage = "library") {
  const router = createFetchRouter();
  router
    .json("GET", "/api/profile", {
      name: "My Library",
      avatarUrl: "",
      bannerUrl: "",
      catEnabled: false,
    })
    .json("GET", "/api/preferences", { startPage })
    .json("GET", "/api/media", mediaItems)
    .json("GET", "/api/favorites", { mediaIds: [] })
    .json("GET", "/api/activity?limit=100", [])
    .json("GET", "/api/activity?limit=500", [])
    .json("GET", "/api/integrations/anilist", disconnectedAniList);
  vi.stubGlobal("fetch", router.fetch);
  return router;
}

describe("Installation start page", () => {
  it.each(
    [
      { page: "overview", heading: "Overview", hash: "#library" },
      { page: "library", heading: "Your collection", hash: "#library/list" },
      { page: "monthly_log", heading: "Monthly Log", hash: "#monthly-log" },
      { page: "activity", heading: "Activity", hash: "#activity" },
    ] as const,
  )(
    "opens $page from the installation preference without adding a history entry",
    async ({ page, heading, hash }) => {
      globalThis.history.replaceState(
        { preserved: true },
        "",
        "/?return=connected",
      );
      const length = globalThis.history.length;
      bootstrap(page);
      render(<App />);
      expect(screen.getByRole("main", { name: "Opening Honne" })).not
        .toBeNull();
      expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();
      expect(await screen.findByRole("heading", { name: heading })).not
        .toBeNull();
      expect(globalThis.location.hash).toBe(hash);
      expect(globalThis.location.search).toBe("?return=connected");
      expect(globalThis.history.state).toEqual({ preserved: true });
      expect(globalThis.history.length).toBe(length);
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("main"))
      );
    },
  );

  it.each([
    { hash: "#library", heading: "Overview" },
    { hash: "#library/list", heading: "Your collection" },
    { hash: "#monthly-log", heading: "Monthly Log" },
    { hash: "#highlights", heading: "Monthly Log" },
    { hash: "#activity", heading: "Activity" },
    { hash: "#settings", heading: "Settings" },
    { hash: "#media/1", heading: "Cowboy Bebop" },
    { hash: "#search/book/Dune", heading: "Results for “Dune”" },
  ])(
    "preserves the explicit $hash deep link on load and reload",
    async ({ hash, heading }) => {
      globalThis.history.replaceState(null, "", `/${hash}`);
      const router = bootstrap("activity");
      router.json("GET", "/api/discovery/search?type=book&q=Dune&page=1", {
        results: [],
        page: 1,
        hasMore: false,
      });
      const first = render(<App />);
      expect(await screen.findByRole("heading", { name: heading })).not
        .toBeNull();
      expect(globalThis.location.hash).toBe(hash);
      first.unmount();
      render(<App />);
      expect(await screen.findByRole("heading", { name: heading })).not
        .toBeNull();
      expect(globalThis.location.hash).toBe(hash);
    },
  );

  it("does not apply a stale preference after the user navigates during startup", async () => {
    globalThis.history.replaceState(null, "", "/");
    const router = bootstrap();
    let finish: ((response: Response) => void) | undefined;
    let signal: AbortSignal | undefined;
    router.json("GET", "/api/preferences", (request: Request) => {
      signal = request.signal;
      return new Promise<Response>((resolve) => finish = resolve);
    });
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("main", { name: "Opening Honne" })).not.toBeNull();
    await user.click(
      within(screen.getByRole("navigation", { name: "Primary navigation" }))
        .getByRole("link", { name: "Activity" }),
    );
    expect(await screen.findByRole("heading", { name: "Activity" })).not
      .toBeNull();
    expect(signal?.aborted).toBe(true);
    await act(() =>
      Promise.resolve(finish?.(Response.json({ startPage: "library" })))
    );
    expect(globalThis.location.hash).toBe("#activity");
    expect(screen.getByRole("heading", { name: "Activity" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Your collection" }))
      .toBeNull();
  });

  it("falls back to Overview with an accessible error while preserving collection data", async () => {
    globalThis.history.replaceState(null, "", "/");
    const router = bootstrap();
    router.json(
      "GET",
      "/api/preferences",
      { error: "Preferences unavailable" },
      503,
    );
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Overview" })).not
      .toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not load your start page. Showing Overview. Preferences unavailable",
    );
    await user.click(
      within(screen.getByRole("navigation", { name: "Library sections" }))
        .getByRole("link", { name: "Library" }),
    );
    expect(
      await screen.findByRole("button", { name: /^View details for Dune/ }),
    ).not.toBeNull();
  });

  it("saves without leaving Settings and uses the confirmed choice on a fresh root opening", async () => {
    globalThis.history.replaceState(null, "", "/#settings");
    const router = bootstrap("overview");
    let stored: StartPage = "overview";
    router.json(
      "GET",
      "/api/preferences",
      () => Response.json({ startPage: stored }),
    );
    router.json("PUT", "/api/preferences", async (request: Request) => {
      expect(await request.json()).toEqual({ startPage: "library" });
      stored = "library";
      return Response.json({ startPage: stored });
    });
    const user = userEvent.setup();
    const first = render(<App />);
    const select = screen.getByRole("combobox", { name: "Initial tab" });
    await waitFor(() => expect(select).toHaveProperty("disabled", false));
    await user.selectOptions(select, "library");
    await user.click(screen.getByRole("button", { name: "Save start page" }));
    expect(await screen.findByText("Start page saved for all devices.")).not
      .toBeNull();
    expect(globalThis.location.hash).toBe("#settings");
    first.unmount();
    globalThis.history.replaceState(null, "", "/");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Your collection" })).not
      .toBeNull();
    expect(globalThis.location.hash).toBe("#library/list");
  });

  it("preserves back and forward navigation after resolving the root", async () => {
    globalThis.history.replaceState(null, "", "/");
    bootstrap("library");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Your collection" });
    await user.click(
      within(screen.getByRole("navigation", { name: "Library sections" }))
        .getByRole("link", { name: "Overview" }),
    );
    await screen.findByRole("heading", { name: "Overview" });
    globalThis.history.back();
    await screen.findByRole("heading", { name: "Your collection" });
    expect(globalThis.location.hash).toBe("#library/list");
    globalThis.history.forward();
    await screen.findByRole("heading", { name: "Overview" });
    expect(globalThis.location.hash).toBe("#library");
  });

  it("refreshes the saved preference after backup restore without leaving Settings", async () => {
    globalThis.history.replaceState(null, "", "/#settings");
    const router = bootstrap("library");
    let restored = false;
    router.json(
      "GET",
      "/api/preferences",
      () => Response.json({ startPage: restored ? "activity" : "library" }),
    );
    router.json("POST", "/api/backup/preview", {
      version: 11,
      items: 3,
      activities: 0,
      pendingAniListChanges: 0,
    });
    router.json("POST", "/api/backup/restore", () => {
      restored = true;
      return Response.json({
        version: 11,
        items: 3,
        activities: 0,
        pendingAniListChanges: 0,
      });
    });
    const user = userEvent.setup();
    render(<App />);
    const select = screen.getByRole("combobox", { name: "Initial tab" });
    await waitFor(() => expect(select).toHaveProperty("value", "library"));
    await user.upload(
      screen.getByLabelText("Choose backup JSON"),
      new File(['{"version":11,"items":[]}'], "backup.json", {
        type: "application/json",
      }),
    );
    await screen.findByText("Ready to restore");
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Replace with this backup" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Initial tab" }))
        .toHaveProperty("value", "activity")
    );
    expect(globalThis.location.hash).toBe("#settings");
    expect(screen.getByRole("heading", { name: "Settings" })).not.toBeNull();
  });
});
