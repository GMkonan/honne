import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import { disconnectedAniList, mediaItems } from "./test/fixtures.ts";
import { createFetchRouter, type FetchRouter } from "./test/fetch-router.ts";

function bootstrap(
  router: FetchRouter,
  items: unknown[] = mediaItems,
  profile = { name: "My Library", avatarUrl: "" },
) {
  router
    .json("GET", "/api/profile", profile)
    .json("GET", "/api/media", items)
    .json("GET", "/api/integrations/anilist", disconnectedAniList)
    .json("GET", "/api/activity?limit=100", []);
  vi.stubGlobal("fetch", router.fetch);
}

function visibleMediaTitles(): string[] {
  return screen.getAllByRole("button", { name: /^View details for/ }).map(
    (button) =>
      button.getAttribute("aria-label")?.replace(
        "View details for ",
        "",
      ).replace(/\. Status:.*$/u, "") || "",
  );
}

describe("Library characterization", () => {
  beforeEach(() => {
    globalThis.history.replaceState(null, "", "/#library");
  });

  it("renders the current Library after successful bootstrap responses", async () => {
    const router = createFetchRouter();
    bootstrap(router);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "My Library" }))
      .not.toBeNull();
    const hero = screen.getByRole("region", { name: "My Library" });
    expect(within(hero).getByText("Total titles")).not.toBeNull();
    expect(within(hero).getByText("3")).not.toBeNull();
    expect(within(hero).getByText("In progress")).not.toBeNull();
    expect(visibleMediaTitles()).toEqual([
      "Dune",
      "Spirited Away",
      "Cowboy Bebop",
    ]);
    const duneCard = screen.getByRole("button", {
      name: /^View details for Dune/,
    });
    expect(within(duneCard).getByText("Plan to read")).not.toBeNull();
    expect(duneCard.getAttribute("aria-label")).toContain(
      "Status: Plan to read",
    );
  });

  it("renders the configured profile and falls back to the default kanji mark", async () => {
    const router = createFetchRouter();
    bootstrap(router, mediaItems, {
      name: "Konan Library",
      avatarUrl: "https://images.example.com/avatar.png",
    });
    render(<App />);

    const avatar = await screen.findByRole("img", {
      name: "Konan Library profile",
    });
    fireEvent.error(avatar);

    const defaultMark = await screen.findByRole("img", {
      name: "Konan Library default profile mark",
    });
    expect(defaultMark.textContent).toBe("本音");
  });

  it("renders a textual badge for every media status", async () => {
    const router = createFetchRouter();
    const statuses = [
      ["planned", "Plan to watch"],
      ["in_progress", "In progress"],
      ["completed", "Completed"],
      ["paused", "Paused"],
      ["dropped", "Dropped"],
    ] as const;
    bootstrap(
      router,
      statuses.map(([status], index) => ({
        ...mediaItems[0],
        id: index + 1,
        title: `Title ${index + 1}`,
        status,
      })),
    );
    render(<App />);

    await screen.findByRole("button", { name: /^View details for Title 1/ });
    for (const [_, label] of statuses) {
      expect(
        screen.getByRole("button", {
          name: new RegExp(`^View details for .+\\. Status: ${label}$`, "u"),
        }),
      ).not.toBeNull();
    }
  });

  it("filters the Library by media type and status", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^View details for Dune/ });

    const books = screen.getByRole("button", { name: /^Books/ });
    books.focus();
    await user.keyboard("{Enter}");
    expect(books.getAttribute("aria-pressed")).toBe("true");
    expect(visibleMediaTitles()).toEqual(["Dune"]);

    const statusFilters = screen.getByRole("complementary", {
      name: "Status filters",
    });
    const planned = within(statusFilters).getByRole("button", {
      name: /^Plan to read/,
    });
    await user.click(planned);
    expect(planned.getAttribute("aria-pressed")).toBe("true");
    expect(visibleMediaTitles()).toEqual(["Dune"]);
  });

  it("sorts and resets the current collection", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^View details for Dune/ });

    await user.selectOptions(screen.getByLabelText("Sort"), "title");
    expect(visibleMediaTitles()).toEqual([
      "Cowboy Bebop",
      "Dune",
      "Spirited Away",
    ]);

    await user.click(screen.getByRole("button", { name: /^Books/ }));
    expect(visibleMediaTitles()).toEqual(["Dune"]);
    await user.click(screen.getByRole("button", { name: "Reset" }));

    expect(visibleMediaTitles()).toEqual([
      "Cowboy Bebop",
      "Dune",
      "Spirited Away",
    ]);
    expect(
      screen.getByRole("button", { name: /^All media/ }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("moves persistent manual entry from the Library to full search", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    router.json(
      "GET",
      "/api/discovery/global?q=Missing",
      () => new Promise<Response>(() => {}),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^View details for Dune/ });

    expect(screen.queryByRole("button", { name: "Add title" })).toBeNull();
    await user.type(
      screen.getByLabelText("Search library and catalogs"),
      "Missing{Enter}",
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Add manually",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Add media" })).not.toBeNull();
  });

  it("preserves empty-state and manual-add entry behavior", async () => {
    const router = createFetchRouter();
    bootstrap(router, []);
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Your library is empty.",
      }),
    ).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Add your first title" }),
    );
    expect(screen.getByRole("dialog", { name: "Find something to add" })).not
      .toBeNull();
    await user.click(screen.getByRole("button", { name: "Add manually" }));
    expect(screen.getByRole("dialog", { name: "Add media" })).not.toBeNull();
  });

  it("keeps media details reachable from a Library card", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /^View details for Cowboy Bebop/,
      }),
    );

    expect(await screen.findByRole("heading", { name: "Cowboy Bebop" })).not
      .toBeNull();
  });
});
