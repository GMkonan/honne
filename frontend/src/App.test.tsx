import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import { disconnectedAniList, mediaItems } from "./test/fixtures.ts";
import { createFetchRouter, type FetchRouter } from "./test/fetch-router.ts";

function bootstrap(router: FetchRouter, items: unknown[] = mediaItems) {
  router
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
      ) || "",
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

    expect(await screen.findByRole("heading", { name: "What stays with you." }))
      .not.toBeNull();
    expect(screen.getByText(/3 works kept/)).not.toBeNull();
    expect(visibleMediaTitles()).toEqual([
      "Dune",
      "Spirited Away",
      "Cowboy Bebop",
    ]);
  });

  it("filters the Library by media type and status", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "View details for Dune" });

    const books = screen.getByRole("button", { name: /^Books/ });
    await user.click(books);
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
    await screen.findByRole("button", { name: "View details for Dune" });

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
        name: "View details for Cowboy Bebop",
      }),
    );

    expect(await screen.findByRole("heading", { name: "Cowboy Bebop" })).not
      .toBeNull();
  });
});
