import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

  it("keeps Library items out of catalog suggestions", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    router.json("GET", "/api/discovery/global?q=Dun", {
      results: [
        {
          provider: "openlibrary",
          providerId: "dune",
          providerUrl: "https://example.com/dune",
          type: "book",
          title: "Dune",
        },
        {
          provider: "openlibrary",
          providerId: "messiah",
          providerUrl: "https://example.com/messiah",
          type: "book",
          title: "Dune Messiah",
        },
      ],
      unavailableTypes: [],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^View details for Dune/ });

    await user.type(
      screen.getByRole("combobox", { name: "Search catalogs" }),
      "Dun",
    );
    expect(
      await screen.findByRole("option", { name: /Dune Messiah.*Catalog/u }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("option", { name: /^Dune Book Catalog$/u }),
    ).toBeNull();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(
      await screen.findByRole("heading", { name: "Dune Messiah" }),
    ).not.toBeNull();
  });

  it("debounces catalog suggestions and limits the dropdown to five", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    router.json("GET", "/api/discovery/global?q=Nar", {
      results: [
        ["anime", "Naruto"],
        ["series", "Narcos"],
        ["movie", "Narc"],
        ["book", "Narrative Economics"],
        ["manga", "Naruto Gaiden"],
        ["light_novel", "Naruto: Innocent Heart"],
      ].map(([type, title], index) => ({
        provider: `provider-${index}`,
        providerId: String(index),
        providerUrl: `https://example.com/${index}`,
        type,
        title,
      })),
      unavailableTypes: [],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^View details for Dune/ });

    await user.type(
      screen.getByRole("combobox", {
        name: "Search catalogs",
      }),
      "Nar",
    );
    expect(screen.getByRole("status").textContent).toContain(
      "Searching catalogs",
    );

    const suggestions = await screen.findByRole("listbox", {
      name: "Catalog suggestions",
    });
    await waitFor(
      () => expect(within(suggestions).getAllByRole("option")).toHaveLength(5),
      { timeout: 1500 },
    );
    expect(router.fetch).toHaveBeenCalledWith(
      "/api/discovery/global?q=Nar",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("groups full search results, filters types, and retries partial catalogs", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    let catalogRequests = 0;
    router.json("GET", "/api/discovery/global?q=Mix", () => {
      catalogRequests++;
      const results = [
        {
          provider: "anilist",
          providerId: "anime-1",
          providerUrl: "https://example.com/anime-1",
          type: "anime",
          title: "Mixed Anime",
        },
        ...(catalogRequests === 1
          ? [{
            provider: "openlibrary",
            providerId: "book-1",
            providerUrl: "https://example.com/book-1",
            type: "book",
            title: "Mixed Book",
          }]
          : []),
      ];
      return new Response(
        JSON.stringify({
          results,
          unavailableTypes: catalogRequests === 1 ? ["series"] : [],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: /^View details for Dune/ });

    await user.type(
      screen.getByRole("combobox", {
        name: "Search catalogs",
      }),
      "Mix",
    );
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("heading", { name: "Results for “Mix”" }),
    ).not.toBeNull();
    expect(
      await screen.findByRole("button", {
        name: "Review Mixed Anime from Anime",
      }),
    ).not.toBeNull();
    expect(screen.getByText(/Some catalogs could not respond/u)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Books1" }));
    expect(
      screen.queryByRole("button", { name: "Review Mixed Anime from Anime" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review Mixed Book from Books" }),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(catalogRequests).toBe(2));
    expect(
      await screen.findByRole("button", {
        name: "Review Mixed Anime from Anime",
      }),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Books1" })).toBeNull();
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
      screen.getByLabelText("Search catalogs"),
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
