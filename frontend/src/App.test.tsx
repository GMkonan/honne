import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import type { Media, MediaInput } from "./types/media.ts";
import {
  addedActivity,
  connectedAniList,
  cowboyBebop,
  samuraiChamploo,
} from "./test/fixtures.ts";
import { createFetchRouter, type FetchRouter } from "./test/fetch-router.ts";

function inputElement(element: HTMLElement): HTMLInputElement {
  expect(element).toBeInstanceOf(HTMLInputElement);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Expected an input element");
  }
  return element;
}

function bootstrap(router: FetchRouter, items: Media[] = [cowboyBebop]) {
  router
    .json("GET", "/api/media", items)
    .json("GET", "/api/integrations/anilist", connectedAniList)
    .json("GET", "/api/activity?limit=100", [addedActivity]);
  vi.stubGlobal("fetch", router.fetch);
}

describe("App characterization", () => {
  beforeEach(() => {
    globalThis.history.replaceState(null, "", "/#library");
  });

  it("renders the existing application after successful bootstrap responses", async () => {
    const router = createFetchRouter();
    bootstrap(router);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "What stays with you." }))
      .not.toBeNull();
    expect(screen.getByText(/1 works kept/)).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "View details for Cowboy Bebop" }),
    ).not.toBeNull();
    expect(screen.queryByText("Opening your collection...")).toBeNull();
  });

  it("preserves media CRUD behavior", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    let createdPayload: MediaInput | undefined;
    let updatedPayload: MediaInput | undefined;
    router
      .json("POST", "/api/media", async (request: Request) => {
        createdPayload = await request.json();
        return Response.json({
          ...createdPayload,
          id: 2,
          createdAt: "2026-01-03T00:00:00Z",
          updatedAt: "2026-01-03T00:00:00Z",
        });
      })
      .json("PATCH", "/api/media/2", async (request: Request) => {
        updatedPayload = await request.json();
        return Response.json({
          ...updatedPayload,
          id: 2,
          createdAt: "2026-01-03T00:00:00Z",
          updatedAt: "2026-01-04T00:00:00Z",
        });
      })
      .empty("DELETE", "/api/media/2");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", {
      name: "View details for Cowboy Bebop",
    });

    await user.click(screen.getByRole("button", { name: "Add title" }));
    await user.click(screen.getByRole("button", { name: "Add manually" }));
    const addDialog = screen.getByRole("dialog", { name: "Add media" });
    await user.type(within(addDialog).getByLabelText(/Title/), "Dune");
    await user.click(
      within(addDialog).getByRole("button", { name: "Add to collection" }),
    );

    expect(await screen.findByRole("button", { name: "View details for Dune" }))
      .not.toBeNull();
    expect(createdPayload?.title).toBe("Dune");
    expect(Object.keys(createdPayload || {})).not.toContain("id");

    await user.click(screen.getAllByRole("button", { name: "Update" })[0]);
    const updateDialog = screen.getByRole("dialog", { name: "Update media" });
    const progress = within(updateDialog).getByLabelText(/Current progress/);
    await user.clear(progress);
    await user.type(progress, "5");
    await user.click(
      within(updateDialog).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() => expect(updatedPayload?.progress).toBe(5));

    await user.click(screen.getByRole("button", { name: "Delete Dune" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "View details for Dune" }))
        .toBeNull()
    );
  });

  it("preserves duplicate-create recovery", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    router.json(
      "POST",
      "/api/media",
      { error: "Title already exists", existingId: 1 },
      409,
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", {
      name: "View details for Cowboy Bebop",
    });

    await user.click(screen.getByRole("button", { name: "Add title" }));
    await user.click(screen.getByRole("button", { name: "Add manually" }));
    await user.type(screen.getByLabelText(/Title/), "Duplicate");
    await user.click(screen.getByRole("button", { name: "Add to collection" }));

    const updateDialog = await screen.findByRole("dialog", {
      name: "Update media",
    });
    expect(inputElement(within(updateDialog).getByLabelText(/Title/)).value)
      .toBe("Cowboy Bebop");
  });

  it("preserves Activity and local detail navigation", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", {
      name: "View details for Cowboy Bebop",
    });

    await user.click(screen.getByRole("link", { name: "Activity" }));
    expect(await screen.findByRole("heading", { name: "Activity" })).not
      .toBeNull();
    await user.click(screen.getByRole("button", { name: /Cowboy Bebop/ }));
    expect(await screen.findByRole("heading", { name: "Cowboy Bebop" }))
      .not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Activity" })).not
      .toBeNull();
  });

  it("preserves global search, partial results and external details", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    router.json("GET", "/api/discovery/global?q=samurai", {
      results: [samuraiChamploo],
      unavailableTypes: ["movie"],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", {
      name: "View details for Cowboy Bebop",
    });

    const search = screen.getByLabelText("Search library and catalogs");
    await user.type(search, "samurai{Enter}");
    expect(
      await screen.findByRole("heading", { name: "Results for “samurai”" }),
    )
      .not.toBeNull();
    expect(await screen.findByText(/Unavailable right now: Movies/)).not
      .toBeNull();
    await user.click(screen.getByRole("button", { name: /Samurai Champloo/ }));
    expect(await screen.findByRole("heading", { name: "Samurai Champloo" }))
      .not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Add to library" }));
    const addDialog = screen.getByRole("dialog", { name: "Add media" });
    expect(inputElement(within(addDialog).getByLabelText(/Title/)).value)
      .toBe("Samurai Champloo");
  });

  it("retries the same global search after a failure", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    let attempts = 0;
    router.json("GET", "/api/discovery/global?q=samurai", () => {
      attempts += 1;
      return attempts === 1
        ? Response.json({ error: "Catalog unavailable" }, { status: 502 })
        : Response.json({ results: [samuraiChamploo], unavailableTypes: [] });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", {
      name: "View details for Cowboy Bebop",
    });

    await user.type(
      screen.getByLabelText("Search library and catalogs"),
      "samurai{Enter}",
    );
    expect(await screen.findByText("Catalog unavailable")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByRole("button", { name: /Samurai Champloo/ }))
      .not.toBeNull();
    expect(attempts).toBe(2);
  });

  it("preserves Settings and AniList modal entry flows", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", {
      name: "View details for Cowboy Bebop",
    });

    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).not
      .toBeNull();
    expect(screen.getByText("@synthetic-user")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Manage connection" }));
    expect(screen.getByRole("dialog", { name: "AniList connection" }))
      .not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Close integration" }));

    await user.click(
      screen.getByRole("button", { name: "Import AniList library" }),
    );
    const importDialog = screen.getByRole("dialog", {
      name: "Bring your library with you",
    });
    expect(
      inputElement(within(importDialog).getByLabelText("AniList username"))
        .readOnly,
    ).toBe(true);
  });
});
