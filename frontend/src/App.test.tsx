import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import { disconnectedAniList, mediaItems } from "./test/fixtures.ts";
import { createFetchRouter, type FetchRouter } from "./test/fetch-router.ts";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: originalCreateObjectURL,
    });
  } else delete (URL as { createObjectURL?: unknown }).createObjectURL;
  if (originalRevokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: originalRevokeObjectURL,
    });
  } else delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
});

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
    globalThis.sessionStorage.clear();
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
      ["in_progress", "Watching"],
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
    expect(
      within(statusFilters).getByRole("button", { name: /^Reading/u }),
    ).not.toBeNull();
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

  it("links existing AniList titles and applies their repeat counts", async () => {
    globalThis.history.replaceState(null, "", "/#settings");
    const router = createFetchRouter();
    const linkedItem = {
      ...mediaItems[0],
      provider: "anilist",
      providerId: "20",
      providerUrl: "https://anilist.co/anime/20",
      format: "TV",
    };
    const connected = {
      configured: true,
      connected: true,
      username: "konan",
      deleteOnLocalDelete: true,
      pending: 0,
      errors: 0,
    };
    let submitted: Record<string, unknown> | undefined;
    bootstrap(router, [linkedItem]);
    router
      .json("GET", "/api/integrations/anilist", connected)
      .json("GET", "/api/import/anilist?username=konan", {
        username: "konan",
        entries: [{
          ...linkedItem,
          providerListEntryId: 700,
          alreadyExists: true,
        }],
      })
      .json("POST", "/api/import/anilist", async (request: Request) => {
        submitted = await request.json() as Record<string, unknown>;
        return Response.json({
          imported: 0,
          reconciled: 1,
          skipped: 0,
          items: [],
          reconciledItems: [{
            ...linkedItem,
            repeatCount: 4,
            providerListEntryId: 700,
            syncStatus: "synced",
          }],
        });
      });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Import AniList library" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview list" }));
    const linkButton = await screen.findByRole("button", {
      name: "Link 1 existing titles",
    });
    expect((linkButton as HTMLButtonElement).disabled).toBe(false);
    await user.click(linkButton);

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /Bring your library/u }))
        .toBeNull()
    );
    expect(submitted).toMatchObject({
      username: "konan",
      types: ["anime"],
      statuses: ["in_progress"],
    });
    await user.click(screen.getByRole("link", { name: "Library" }));
    await user.click(
      await screen.findByRole("button", {
        name: /^View details for Cowboy Bebop/,
      }),
    );
    const personal = screen.getByRole("region", { name: "Your Library" });
    const repeatLabel = within(personal).getByText("Rewatches");
    expect(repeatLabel.nextElementSibling?.textContent).toBe("4");
  });

  it("downloads a restorable backup from Settings", async () => {
    globalThis.history.replaceState(null, "", "/#settings");
    const router = createFetchRouter();
    bootstrap(router);
    router.json(
      "GET",
      "/api/backup",
      () =>
        new Response('{"version":3,"items":[]}', {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition":
              'attachment; filename="honne-backup-20260906T230000Z.json"',
          },
        }),
    );
    const createdURLs: string[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => {
        createdURLs.push("blob:honne-backup");
        return "blob:honne-backup";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    let downloadedAs = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadedAs = this.download;
      });
    const user = userEvent.setup();

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Download backup" }),
    );

    expect((await screen.findByRole("status")).textContent).toContain(
      "Backup download started.",
    );
    expect(downloadedAs).toBe("honne-backup-20260906T230000Z.json");
    expect(createdURLs).toEqual(["blob:honne-backup"]);
    await waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:honne-backup")
    );
    expect(router.fetch).toHaveBeenCalledWith(
      "/api/backup",
      expect.objectContaining({
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );

    click.mockRestore();
  });

  it("shows an accessible backup error and allows retry", async () => {
    globalThis.history.replaceState(null, "", "/#settings");
    const router = createFetchRouter();
    bootstrap(router);
    router.json(
      "GET",
      "/api/backup",
      { error: "could not prepare backup" },
      500,
    );
    const user = userEvent.setup();
    render(<App />);

    const button = await screen.findByRole("button", {
      name: "Download backup",
    });
    await user.click(button);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "could not prepare backup",
    );
    expect(button.hasAttribute("disabled")).toBe(false);
    await user.click(button);
    expect(router.fetch).toHaveBeenCalledTimes(6);
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

  it("creates movies without numeric progress fields", async () => {
    const router = createFetchRouter();
    let submitted: Record<string, unknown> | undefined;
    bootstrap(router, []);
    router.json("POST", "/api/media", async (request: Request) => {
      submitted = await request.json() as Record<string, unknown>;
      return Response.json(
        {
          ...mediaItems[2],
          ...submitted,
          id: 1,
          createdAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
        },
        { status: 201 },
      );
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Add your first title" }),
    );
    await user.click(screen.getByRole("button", { name: "Add manually" }));
    const dialog = screen.getByRole("dialog", { name: "Add media" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Title" }),
      "Arrival",
    );
    const typeSelect = within(dialog).getByRole("combobox", { name: "Type" });
    for (
      const [type, progressLabel] of [
        ["anime", "Episodes watched"],
        ["series", "Episodes watched"],
        ["book", "Pages read"],
        ["manga", "Chapters read"],
        ["light_novel", "Chapters read"],
      ] as const
    ) {
      await user.selectOptions(typeSelect, type);
      expect(
        within(dialog).getByRole("spinbutton", { name: progressLabel }),
      ).not.toBeNull();
    }
    await user.selectOptions(typeSelect, "book");
    expect(within(dialog).getByRole("option", { name: "Reading" })).not
      .toBeNull();
    expect(
      within(dialog).getByRole("spinbutton", {
        name: /Rereads Additional completed readings/u,
      }),
    ).not.toBeNull();
    await user.selectOptions(typeSelect, "movie");

    const repeatCount = within(dialog).getByRole("spinbutton", {
      name: /Rewatches Additional completed viewings/u,
    });
    const rating = within(dialog).getByRole("spinbutton", {
      name: "Rating Leave blank to keep this title unrated.",
    });
    expect((repeatCount as HTMLInputElement).value).toBe("");
    expect((rating as HTMLInputElement).value).toBe("");
    await user.type(rating, "10");
    expect((rating as HTMLInputElement).value).toBe("10");
    expect(
      within(dialog).queryByRole("spinbutton", {
        name: /Progress|episodes|pages|chapters/u,
      }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Add to collection" }),
    );

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toMatchObject({
      title: "Arrival",
      type: "movie",
      progress: 0,
      total: 0,
      rating: 10,
      repeatCount: 0,
    });
  });

  it("keeps the discovery dialog keyboard-contained and restores focus", async () => {
    const router = createFetchRouter();
    bootstrap(router, []);
    const user = userEvent.setup();
    render(<App />);

    const trigger = await screen.findByRole("button", {
      name: "Add your first title",
    });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "Find something to add",
    });
    const anime = within(dialog).getByRole("button", { name: "Anime" });
    const games = within(dialog).getByRole("button", { name: "Games" });
    expect(document.activeElement).toBe(anime);
    expect(games.getAttribute("aria-pressed")).toBe("false");
    await user.click(games);
    expect(games.getAttribute("aria-pressed")).toBe("true");

    within(dialog).getByRole("button", { name: "Close discovery" }).focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Add manually" }),
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Find something to add" }))
      .toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps manual game creation available when RAWG is not configured", async () => {
    const router = createFetchRouter();
    bootstrap(router, []);
    router.json(
      "GET",
      "/api/discovery/search?type=game&q=Hades&page=1",
      { error: "game search requires RAWG_API_KEY" },
      503,
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Add your first title" }),
    );
    await user.click(screen.getByRole("button", { name: "Games" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search for games" }),
      "Hades",
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "RAWG_API_KEY",
    );
    await user.click(screen.getByRole("button", { name: "Add manually" }));
    expect(
      within(screen.getByRole("dialog", { name: "Add media" })).getByRole(
        "option",
        { name: "Games", selected: true },
      ),
    ).not.toBeNull();
  });

  it("ignores a stale game result after the discovery type changes", async () => {
    const router = createFetchRouter();
    let resolveSearch: ((response: Response) => void) | undefined;
    bootstrap(router, []);
    router.json(
      "GET",
      "/api/discovery/search?type=game&q=Hades&page=1",
      () => new Promise<Response>((resolve) => resolveSearch = resolve),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Add your first title" }),
    );
    await user.click(screen.getByRole("button", { name: "Games" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search for games" }),
      "Hades",
    );
    await waitFor(() => expect(resolveSearch).toBeDefined());
    await user.click(screen.getByRole("button", { name: "Anime" }));
    resolveSearch?.(Response.json({
      results: [{
        provider: "rawg",
        providerId: "420",
        providerUrl: "https://rawg.io/games/hades",
        type: "game",
        title: "Stale Hades",
      }],
      page: 1,
      hasMore: false,
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Stale Hades")).toBeNull();
  });

  it("clears incompatible fields when a new entry changes type", async () => {
    const router = createFetchRouter();
    const submissions: Record<string, unknown>[] = [];
    bootstrap(router, []);
    router.json("POST", "/api/media", async (request: Request) => {
      const payload = await request.json() as Record<string, unknown>;
      submissions.push(payload);
      return Response.json(
        {
          ...mediaItems[0],
          ...payload,
          id: submissions.length,
          createdAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
        },
        { status: 201 },
      );
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Add your first title" }),
    );
    await user.click(screen.getByRole("button", { name: "Add manually" }));
    let dialog = screen.getByRole("dialog", { name: "Add media" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Title" }),
      "Progress to game",
    );
    await user.type(
      within(dialog).getByRole("spinbutton", { name: /Episodes watched/u }),
      "4",
    );
    await user.type(
      within(dialog).getByRole("spinbutton", { name: /Total episodes/u }),
      "10",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Type" }),
      "game",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add to collection" }),
    );
    await waitFor(() => expect(submissions).toHaveLength(1));
    expect(submissions[0]).toMatchObject({
      type: "game",
      progress: 0,
      total: 0,
    });

    await user.click(screen.getByRole("button", { name: /Books.*本.*0/u }));
    await user.click(screen.getByRole("button", { name: "Add another title" }));
    await user.click(screen.getByRole("button", { name: "Games" }));
    await user.click(screen.getByRole("button", { name: "Add manually" }));
    dialog = screen.getByRole("dialog", { name: "Add media" });
    await user.type(
      within(dialog).getByRole("textbox", { name: "Title" }),
      "Game to book",
    );
    await user.type(
      within(dialog).getByRole("spinbutton", { name: /Playtime \(hours\)/u }),
      "0.5",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /Played on/u }),
      "PC",
    );
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Type" }),
      "book",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add to collection" }),
    );
    await waitFor(() => expect(submissions).toHaveLength(2));
    expect(submissions[1]).toMatchObject({
      type: "book",
      playtimeMinutes: 0,
      playedOnPlatforms: [],
    });
  });

  it("searches RAWG, enriches game details, and preserves catalog metadata", async () => {
    const router = createFetchRouter();
    let submitted: Record<string, unknown> | undefined;
    bootstrap(router, []);
    router.json(
      "GET",
      "/api/discovery/search?type=game&q=Hades&page=1",
      {
        results: [{
          provider: "rawg",
          providerId: "420",
          providerUrl: "https://rawg.io/games/hades",
          type: "game",
          title: "Hades",
          coverUrl: "https://images.example/hades.jpg",
          releaseYear: 2020,
          genres: ["Action"],
          catalogPlatforms: ["PC"],
          communityRating: 9,
        }],
        page: 1,
        hasMore: false,
      },
    );
    router.json(
      "GET",
      "/api/discovery/detail?provider=rawg&type=game&id=420",
      {
        provider: "rawg",
        providerId: "420",
        providerUrl: "https://rawg.io/games/hades",
        type: "game",
        title: "Hades",
        description: "Escape the Underworld.",
        coverUrl: "https://images.example/hades.jpg",
        releaseYear: 2020,
        startDate: "2020-09-17",
        releaseStatus: "finished",
        genres: ["Action", "Indie"],
        credits: [{ name: "Supergiant Games", role: "Developer" }],
        catalogPlatforms: ["PC", "PlayStation 5"],
        communityRating: 9,
      },
    );
    router.json("POST", "/api/media", async (request: Request) => {
      submitted = await request.json() as Record<string, unknown>;
      return Response.json({
        ...mediaItems[0],
        ...submitted,
        id: 1,
        createdAt: "2026-01-05T00:00:00Z",
        updatedAt: "2026-01-05T00:00:00Z",
      }, { status: 201 });
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Add your first title" }),
    );
    await user.click(screen.getByRole("button", { name: "Games" }));
    const search = screen.getByRole("textbox", { name: "Search for games" });
    await user.type(search, "Hades");
    const result = await screen.findByRole("button", { name: /Hades/u });
    expect(
      within(screen.getByRole("dialog", { name: "Find something to add" }))
        .getByRole("status").textContent,
    ).toContain("1 catalog results available");
    expect(screen.getAllByRole("link", { name: "RAWG" }).length)
      .toBeGreaterThan(
        0,
      );
    await user.click(result);

    expect(await screen.findByText("Escape the Underworld.")).not.toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Hades", level: 1 }),
    );
    expect(screen.getByRole("heading", { name: "Available on" })).not
      .toBeNull();
    expect(screen.getByText("PlayStation 5")).not.toBeNull();
    expect(screen.getByText("Supergiant Games")).not.toBeNull();
    expect(screen.getByRole("link", { name: /View on RAWG/u })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Add to Library" }));
    const addDialog = screen.getByRole("dialog", { name: "Add media" });
    expect(within(addDialog).getByRole("link", { name: "RAWG" })).not
      .toBeNull();
    await user.click(
      within(addDialog).getByRole(
        "button",
        { name: "Add to collection" },
      ),
    );

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toMatchObject({
      provider: "rawg",
      providerId: "420",
      type: "game",
      title: "Hades",
      catalogPlatforms: ["PC", "PlayStation 5"],
      genres: ["Action", "Indie"],
      credits: [{ name: "Supergiant Games", role: "Developer" }],
    });
  });

  it("keeps partial RAWG details usable when enrichment fails", async () => {
    const result = {
      provider: "rawg",
      providerId: "420",
      providerUrl: "https://rawg.io/games/hades",
      type: "game",
      title: "Hades",
      catalogPlatforms: ["PC"],
    };
    globalThis.sessionStorage.setItem(
      "honne:catalog:rawg:game:420",
      JSON.stringify(result),
    );
    globalThis.history.replaceState(null, "", "/#catalog/rawg/game/420");
    const router = createFetchRouter();
    bootstrap(router, []);
    router.json(
      "GET",
      "/api/discovery/detail?provider=rawg&type=game&id=420",
      { error: "the metadata provider is temporarily unavailable" },
      502,
    );
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Hades" })).not
      .toBeNull();
    expect((await screen.findByRole("status")).textContent).toContain(
      "Some catalog details could not be loaded",
    );
    expect(screen.getByRole("button", { name: "Add to Library" })).not
      .toBeNull();
    expect(screen.getByText("PC")).not.toBeNull();
  });

  it("creates and manages games with playtime and personal platforms", async () => {
    const router = createFetchRouter();
    let created: Record<string, unknown> | undefined;
    let updated: Record<string, unknown> | undefined;
    bootstrap(router, []);
    router.json("POST", "/api/media", async (request: Request) => {
      created = await request.json() as Record<string, unknown>;
      return Response.json(
        {
          ...mediaItems[0],
          ...created,
          id: 1,
          createdAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
        },
        { status: 201 },
      );
    });
    router.json("PATCH", "/api/media/1", async (request: Request) => {
      const payload = await request.json() as Record<string, unknown>;
      if ((payload.playedOnPlatforms as string[]).length > 12) {
        return Response.json(
          { error: "played-on platforms cannot contain more than 12 entries" },
          { status: 422 },
        );
      }
      updated = payload;
      return Response.json({
        ...mediaItems[0],
        ...updated,
        id: 1,
        createdAt: "2026-01-05T00:00:00Z",
        updatedAt: "2026-01-06T00:00:00Z",
      });
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", { name: "Add your first title" }),
    );
    await user.click(screen.getByRole("button", { name: "Games" }));
    expect(screen.getByRole("textbox", { name: /Search for games/u })).not
      .toBeNull();
    await user.click(screen.getByRole("button", { name: "Add manually" }));

    const dialog = screen.getByRole("dialog", { name: "Add media" });
    expect(
      within(dialog).getByRole("option", { name: "Games", selected: true }),
    ).not.toBeNull();
    expect(within(dialog).getByRole("option", { name: "Plan to play" })).not
      .toBeNull();
    expect(within(dialog).getByRole("option", { name: "Playing" })).not
      .toBeNull();
    expect(
      within(dialog).queryByRole("spinbutton", {
        name: /Progress|episodes|pages|chapters/u,
      }),
    ).toBeNull();
    await user.type(
      within(dialog).getByRole("textbox", { name: "Title" }),
      "Celeste",
    );
    await user.type(
      within(dialog).getByRole("spinbutton", { name: /Playtime \(hours\)/u }),
      "1.5",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: /Played on/u }),
      "PC, Switch, pc",
    );
    await user.type(
      within(dialog).getByRole("spinbutton", {
        name: /Replays Additional completed playthroughs/u,
      }),
      "2",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add to collection" }),
    );

    await waitFor(() => expect(created).toBeDefined());
    expect(created).toMatchObject({
      title: "Celeste",
      type: "game",
      status: "planned",
      progress: 0,
      total: 0,
      repeatCount: 2,
      playtimeMinutes: 90,
      playedOnPlatforms: ["PC", "Switch"],
    });
    expect(screen.getByText("1h 30m")).not.toBeNull();
    const gamesFilter = screen.getByRole("button", {
      name: /Games.*ゲーム.*1/u,
    });
    await user.click(gamesFilter);
    expect(gamesFilter.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Celeste")).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: /^View details for Celeste/u }),
    );
    const personal = screen.getByRole("region", { name: "Your Library" });
    expect(within(personal).getByText("Plan to play")).not.toBeNull();
    expect(within(personal).getByText("1h 30m")).not.toBeNull();
    expect(within(personal).getByText("PC · Switch")).not.toBeNull();
    expect(
      within(personal).getByText("Replays").nextElementSibling?.textContent,
    )
      .toBe("2");

    await user.click(
      within(personal).getByRole("button", { name: "Manage title" }),
    );
    const manager = screen.getByRole("dialog", { name: "Manage Celeste" });
    const playtime = within(manager).getByRole("spinbutton", {
      name: /Playtime \(hours\)/u,
    });
    const platforms = within(manager).getByRole("textbox", {
      name: /Played on/u,
    });
    expect((playtime as HTMLInputElement).value).toBe("1.5");
    await user.clear(playtime);
    await user.type(playtime, "0.5");
    expect((playtime as HTMLInputElement).value).toBe("0.5");
    const excessivePlatforms = Array.from(
      { length: 13 },
      (_, index) => `Platform ${index}`,
    ).join(", ");
    await user.clear(platforms);
    await user.type(platforms, excessivePlatforms);
    await user.click(
      within(manager).getByRole("button", { name: "Save changes" }),
    );

    expect((await within(manager).findByRole("alert")).textContent).toBe(
      "played-on platforms cannot contain more than 12 entries",
    );
    expect((platforms as HTMLInputElement).value).toBe(excessivePlatforms);
    expect(updated).toBeUndefined();

    await user.clear(platforms);
    await user.type(platforms, "PC, Switch");
    await user.click(
      within(manager).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(updated).toBeDefined());
    expect(updated).toMatchObject({
      type: "game",
      playtimeMinutes: 30,
      playedOnPlatforms: ["PC", "Switch"],
    });

    await user.click(
      within(personal).getByRole("button", { name: "Manage title" }),
    );
    const reopenedManager = screen.getByRole("dialog", {
      name: "Manage Celeste",
    });
    const reopenedPlaytime = within(reopenedManager).getByRole("spinbutton", {
      name: /Playtime \(hours\)/u,
    });
    expect((reopenedPlaytime as HTMLInputElement).value).toBe("0.5");
    await user.clear(reopenedPlaytime);
    await user.click(
      within(reopenedManager).getByRole("button", { name: "Save changes" }),
    );
    await waitFor(() => expect(updated?.playtimeMinutes).toBe(0));
  });

  it("keeps catalog movie metadata separate from personal progress", async () => {
    const result = {
      provider: "tmdb",
      providerId: "329865",
      providerUrl: "https://www.themoviedb.org/movie/329865",
      type: "movie",
      title: "Arrival",
      total: 1,
      catalogTotal: 1,
      durationMinutes: 116,
    };
    globalThis.sessionStorage.setItem(
      "honne:catalog:tmdb:movie:329865",
      JSON.stringify(result),
    );
    globalThis.history.replaceState(
      null,
      "",
      "/#catalog/tmdb/movie/329865",
    );
    const router = createFetchRouter();
    let submitted: Record<string, unknown> | undefined;
    bootstrap(router, []);
    router.json("POST", "/api/media", async (request: Request) => {
      submitted = await request.json() as Record<string, unknown>;
      return Response.json(
        {
          ...mediaItems[2],
          ...submitted,
          id: 1,
          createdAt: "2026-01-05T00:00:00Z",
          updatedAt: "2026-01-05T00:00:00Z",
        },
        { status: 201 },
      );
    });
    const user = userEvent.setup();
    render(<App />);

    const addPanel = await screen.findByRole("region", {
      name: "Add to your Library",
    });
    expect(within(addPanel).queryByText(/progress/u)).toBeNull();
    expect(screen.queryByText("1 parts")).toBeNull();
    expect(screen.getByText("116 min")).not.toBeNull();
    await user.click(
      within(addPanel).getByRole("button", { name: "Add to Library" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add media" });
    expect(
      within(dialog).queryByRole("spinbutton", {
        name: /Progress|episodes|pages|chapters/u,
      }),
    ).toBeNull();
    await user.click(
      within(dialog).getByRole("button", { name: "Add to collection" }),
    );

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toMatchObject({
      type: "movie",
      progress: 0,
      total: 0,
      catalogTotal: 1,
    });
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
    expect(
      screen.getByRole("region", { name: "About this title" }),
    ).not.toBeNull();
    const personal = screen.getByRole("region", { name: "Your Library" });
    expect(within(personal).getByText("Watching")).not.toBeNull();
    expect(within(personal).getByText("Episodes watched")).not.toBeNull();
    expect(within(personal).getByText("8 of 26")).not.toBeNull();
    expect(within(personal).getByText("9/10")).not.toBeNull();
    const repeatLabel = within(personal).getByText("Rewatches");
    expect(repeatLabel.nextElementSibling?.textContent).toBe("0");

    const manageTrigger = screen.getByRole("button", { name: "Manage title" });
    await user.click(manageTrigger);
    await user.click(
      screen.getByRole("button", { name: "Edit title details" }),
    );
    const editor = screen.getByRole("dialog", { name: "Update media" });
    const titleInput = within(editor).getByRole("textbox", { name: "Title" });
    expect((titleInput as HTMLInputElement).value).toBe("Cowboy Bebop");
    expect(document.activeElement).toBe(titleInput);
    expect(
      (within(editor).getByRole("combobox", {
        name: /Type/,
      }) as HTMLSelectElement)
        .disabled,
    ).toBe(false);
    const closeEditor = within(editor).getByRole("button", { name: "Close" });
    closeEditor.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      within(editor).getByRole("button", { name: "Save changes" }),
    );
    await user.tab();
    expect(document.activeElement).toBe(closeEditor);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Update media" })).toBeNull();
    expect(document.activeElement).toBe(manageTrigger);
  });

  it("automatically enriches an existing provider title on first detail view", async () => {
    const router = createFetchRouter();
    const linkedItem = {
      ...mediaItems[0],
      provider: "anilist",
      providerId: "1",
      providerUrl: "https://anilist.co/anime/1",
    };
    bootstrap(router, [linkedItem]);
    router.json("POST", "/api/media/1/refresh-metadata", {
      ...linkedItem,
      format: "TV",
      genres: ["Action", "Sci-Fi"],
      credits: [{ name: "Sunrise", role: "Studio" }],
      releaseStatus: "finished",
      startDate: "1998-04-03",
      endDate: "1999-04-24",
      durationMinutes: 25,
      catalogTotal: 26,
      communityRating: 8.2,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /^View details for Cowboy Bebop/,
      }),
    );

    expect(await screen.findByText("Sci-Fi")).not.toBeNull();
    expect(screen.getByText("Sunrise")).not.toBeNull();
    expect(screen.getByText("25 min / episode")).not.toBeNull();
    expect(screen.getByText("8.2/10 community")).not.toBeNull();
    expect(screen.getByText("8 of 26")).not.toBeNull();
    expect(router.fetch).toHaveBeenCalledWith(
      "/api/media/1/refresh-metadata",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("updates personal tracking without losing catalog metadata", async () => {
    const router = createFetchRouter();
    let submitted: Record<string, unknown> | undefined;
    const enrichedItem = {
      ...mediaItems[0],
      format: "TV",
      genres: ["Action", "Sci-Fi"],
      credits: [{ name: "Sunrise", role: "Studio" }],
      releaseStatus: "finished",
      startDate: "1998-04-03",
      endDate: "1999-04-24",
      durationMinutes: 25,
      catalogTotal: 26,
      communityRating: 8.2,
    };
    bootstrap(router, [enrichedItem, ...mediaItems.slice(1)]);
    router.json("PATCH", "/api/media/1", async (request: Request) => {
      submitted = await request.json() as Record<string, unknown>;
      return Response.json({
        ...enrichedItem,
        ...submitted,
        updatedAt: "2026-01-05T00:00:00Z",
      });
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /^View details for Cowboy Bebop/,
      }),
    );
    const trigger = screen.getByRole("button", { name: "Manage title" });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Manage Cowboy Bebop",
    });
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: "Status" }),
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Status" }),
      "completed",
    );
    const progress = screen.getByRole("spinbutton", {
      name: "Episodes watched 26 episodes total",
    });
    await user.clear(progress);
    expect((progress as HTMLInputElement).value).toBe("");
    await user.type(progress, "26");
    const rating = screen.getByRole("spinbutton", {
      name: "Personal rating Leave blank to keep this title unrated.",
    });
    await user.clear(rating);
    expect((rating as HTMLInputElement).value).toBe("");
    await user.type(rating, "10");
    expect((rating as HTMLInputElement).value).toBe("10");
    const repeatCount = screen.getByRole("spinbutton", {
      name: /Rewatches Additional completed viewings/u,
    });
    expect((repeatCount as HTMLInputElement).value).toBe("");
    await user.type(repeatCount, "1");
    await user.type(
      screen.getByRole("textbox", { name: "Review / notes" }),
      "A timeless finale.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toMatchObject({
      title: "Cowboy Bebop",
      type: "anime",
      status: "completed",
      progress: 26,
      rating: 10,
      repeatCount: 1,
      notes: "A timeless finale.",
      description: "Synthetic fixture",
      format: "TV",
      genres: ["Action", "Sci-Fi"],
      credits: [{ name: "Sunrise", role: "Studio" }],
      releaseStatus: "finished",
      startDate: "1998-04-03",
      endDate: "1999-04-24",
      durationMinutes: 25,
      catalogTotal: 26,
      communityRating: 8.2,
    });
    expect(await screen.findByText("Completed")).not.toBeNull();
    expect(screen.getByText("26 of 26")).not.toBeNull();
    expect(screen.getByText("A timeless finale.")).not.toBeNull();
    const personal = screen.getByRole("region", { name: "Your Library" });
    expect(within(personal).getByText("Rewatches")).not.toBeNull();
    expect(within(personal).getByText("1")).not.toBeNull();
  });

  it("saves cleared optional numbers as zero and keeps them visually empty", async () => {
    const router = createFetchRouter();
    let submitted: Record<string, unknown> | undefined;
    const repeatedItem = { ...mediaItems[0], repeatCount: 2 };
    bootstrap(router, [repeatedItem]);
    router.json("PATCH", "/api/media/1", async (request: Request) => {
      submitted = await request.json() as Record<string, unknown>;
      return Response.json({
        ...repeatedItem,
        ...submitted,
        updatedAt: "2026-01-05T00:00:00Z",
      });
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /^View details for Cowboy Bebop/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Manage title" }));
    const dialog = screen.getByRole("dialog", {
      name: "Manage Cowboy Bebop",
    });
    const rating = within(dialog).getByRole("spinbutton", {
      name: "Personal rating Leave blank to keep this title unrated.",
    });
    const repeatCount = within(dialog).getByRole("spinbutton", {
      name: /Rewatches Additional completed viewings/u,
    });
    await user.clear(rating);
    await user.clear(repeatCount);
    expect((rating as HTMLInputElement).value).toBe("");
    expect((repeatCount as HTMLInputElement).value).toBe("");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toMatchObject({ rating: 0, repeatCount: 0 });
    await user.click(screen.getByRole("button", { name: "Manage title" }));
    const reopened = screen.getByRole("dialog", {
      name: "Manage Cowboy Bebop",
    });
    expect(
      (within(reopened).getByRole("spinbutton", {
        name: "Personal rating Leave blank to keep this title unrated.",
      }) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (within(reopened).getByRole("spinbutton", {
        name: /Rewatches Additional completed viewings/u,
      }) as HTMLInputElement).value,
    ).toBe("");
  });

  it("hides movie progress while preserving legacy values in updates", async () => {
    const router = createFetchRouter();
    let submitted: Record<string, unknown> | undefined;
    bootstrap(router);
    router.json("PATCH", "/api/media/3", async (request: Request) => {
      submitted = await request.json() as Record<string, unknown>;
      return Response.json({
        ...mediaItems[2],
        ...submitted,
        updatedAt: "2026-01-05T00:00:00Z",
      });
    });
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("progressbar", {
        name: "Episodes watched for Cowboy Bebop",
      }),
    ).not.toBeNull();
    expect(
      screen.getByRole("progressbar", { name: "Pages read for Dune" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("progressbar", {
        name: /Spirited Away/u,
      }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", {
        name: /^View details for Spirited Away/,
      }),
    );
    const personal = screen.getByRole("region", { name: "Your Library" });
    expect(within(personal).queryByText(/Progress|watched|read/u)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Manage title" }));

    const dialog = screen.getByRole("dialog", {
      name: "Manage Spirited Away",
    });
    expect(within(dialog).getByRole("option", { name: "Watching" })).not
      .toBeNull();
    expect(
      within(dialog).queryByRole("spinbutton", {
        name: /Progress|episodes|pages|chapters/u,
      }),
    ).toBeNull();
    const rating = within(dialog).getByRole("spinbutton", {
      name: "Personal rating Leave blank to keep this title unrated.",
    });
    await user.clear(rating);
    await user.type(rating, "9");
    const repeatCount = within(dialog).getByRole("spinbutton", {
      name: /Rewatches Additional completed viewings/u,
    });
    await user.type(repeatCount, "2");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toMatchObject({
      type: "movie",
      progress: 1,
      total: 1,
      rating: 9,
      repeatCount: 2,
    });

    await user.click(screen.getByRole("button", { name: "Manage title" }));
    await user.click(
      screen.getByRole("button", { name: "Edit title details" }),
    );
    const editor = screen.getByRole("dialog", { name: "Update media" });
    expect(
      within(editor).queryByRole("spinbutton", { name: /Progress/u }),
    ).toBeNull();
    await user.selectOptions(
      within(editor).getByRole("combobox", { name: /Type/u }),
      "anime",
    );
    expect(
      (within(editor).getByRole("spinbutton", {
        name: "Episodes watched",
      }) as HTMLInputElement).value,
    ).toBe("1");
    expect(
      (within(editor).getByRole("spinbutton", {
        name: /Total episodes/u,
      }) as HTMLInputElement).value,
    ).toBe("1");
  });

  it("labels Activity progress with the media-specific unit", async () => {
    globalThis.history.replaceState(null, "", "/#activity");
    const router = createFetchRouter();
    bootstrap(router);
    router.json("GET", "/api/activity?limit=100", [
      {
        id: 1,
        mediaId: 1,
        title: "Cowboy Bebop",
        mediaType: "anime",
        action: "updated",
        changes: { fromProgress: 8, toProgress: 9 },
        occurredAt: "2026-01-05T00:00:00Z",
      },
      {
        id: 2,
        mediaId: 2,
        title: "Dune",
        mediaType: "book",
        action: "updated",
        changes: { fromProgress: 100, toProgress: 120 },
        occurredAt: "2026-01-05T00:00:00Z",
      },
      {
        id: 3,
        title: "A manga",
        mediaType: "manga",
        action: "updated",
        changes: { fromProgress: 4, toProgress: 5 },
        occurredAt: "2026-01-05T00:00:00Z",
      },
      {
        id: 4,
        mediaId: 3,
        title: "Spirited Away",
        mediaType: "movie",
        action: "updated",
        changes: { fromProgress: 0, toProgress: 1 },
        occurredAt: "2026-01-05T00:00:00Z",
      },
      {
        id: 5,
        mediaId: 1,
        title: "Cowboy Bebop",
        mediaType: "anime",
        action: "updated",
        changes: { fromRepeatCount: 0, toRepeatCount: 1 },
        occurredAt: "2026-01-05T00:00:00Z",
      },
      {
        id: 6,
        mediaId: 2,
        title: "Dune",
        mediaType: "book",
        action: "updated",
        changes: { fromRepeatCount: 1, toRepeatCount: 2 },
        occurredAt: "2026-01-05T00:00:00Z",
      },
      {
        id: 7,
        title: "Celeste",
        mediaType: "game",
        action: "updated",
        changes: { fromPlaytimeMinutes: 0, toPlaytimeMinutes: 90 },
        occurredAt: "2026-01-05T00:00:00Z",
      },
    ]);
    render(<App />);

    expect(await screen.findByText("Episodes 8 → 9")).not.toBeNull();
    expect(screen.getByText("Pages 100 → 120")).not.toBeNull();
    expect(screen.getByText("Chapters 4 → 5")).not.toBeNull();
    expect(screen.getByText("Progress 0 → 1")).not.toBeNull();
    expect(screen.getByText("Rewatches 0 → 1")).not.toBeNull();
    expect(screen.getByText("Rereads 1 → 2")).not.toBeNull();
    expect(screen.getByText("Playtime Not tracked → 1h 30m")).not.toBeNull();
  });

  it("preserves management values after a failed save and restores focus on Escape", async () => {
    const router = createFetchRouter();
    bootstrap(router);
    router.json(
      "PATCH",
      "/api/media/1",
      { error: "Could not save personal tracking" },
      500,
    );
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: /^View details for Cowboy Bebop/,
      }),
    );
    const trigger = screen.getByRole("button", { name: "Manage title" });
    await user.click(trigger);
    const notes = screen.getByRole("textbox", { name: "Review / notes" });
    await user.type(notes, "Keep this draft");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not save personal tracking",
    );
    expect((notes as HTMLTextAreaElement).value).toBe("Keep this draft");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Manage Cowboy Bebop" }))
      .toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("sanitizes malformed optional metadata restored from session storage", async () => {
    globalThis.sessionStorage.setItem(
      "honne:catalog:kitsu:anime:broken",
      JSON.stringify({
        provider: "kitsu",
        providerId: "broken",
        providerUrl: "https://kitsu.io/anime/broken",
        type: "anime",
        title: "Safe title",
        genres: ["Drama", 42],
        credits: [null, { name: "Safe Studio", role: "Studio" }],
        format: 42,
        startDate: { year: 2020 },
        durationMinutes: "25",
        communityRating: "8.2",
      }),
    );
    globalThis.history.replaceState(
      null,
      "",
      "/#catalog/kitsu/anime/broken",
    );
    const router = createFetchRouter();
    bootstrap(router, []);
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Safe title" }),
    ).not.toBeNull();
    expect(screen.getByText("Drama")).not.toBeNull();
    expect(screen.getByText("Safe Studio")).not.toBeNull();
    expect(screen.queryByText(/community/u)).toBeNull();
  });

  it("opens quick management when a catalog title already exists by title", async () => {
    const result = {
      provider: "kitsu",
      providerId: "46474",
      providerUrl: "https://kitsu.io/anime/46474",
      type: "anime",
      title: "Cowboy Bebop",
      description: "Catalog synopsis",
      subtitle: "TV",
      genres: ["Action", "Sci-Fi"],
      credits: [
        { name: "Sunrise", role: "Studio" },
        { name: "Shinichirō Watanabe", role: "Director" },
      ],
      releaseStatus: "finished",
      startDate: "1998-04-03",
      endDate: "1999-04-24",
      durationMinutes: 25,
      catalogTotal: 26,
      communityRating: 8.2,
    };
    globalThis.sessionStorage.setItem(
      "honne:catalog:kitsu:anime:46474",
      JSON.stringify(result),
    );
    globalThis.history.replaceState(
      null,
      "",
      "/#catalog/kitsu/anime/46474",
    );
    const router = createFetchRouter();
    bootstrap(router);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Finished")).not.toBeNull();
    expect(screen.getByText("Apr 3, 1998 – Apr 24, 1999")).not.toBeNull();
    expect(screen.getByText("26 episodes")).not.toBeNull();
    expect(screen.getByText("25 min / episode")).not.toBeNull();
    expect(screen.getByText("8.2/10 community")).not.toBeNull();
    const genres = screen.getByRole("region", { name: "Genres" });
    expect(within(genres).getByText("Action")).not.toBeNull();
    expect(within(genres).getByText("Sci-Fi")).not.toBeNull();
    const credits = screen.getByRole("region", { name: "Credits" });
    expect(within(credits).getByText("Sunrise")).not.toBeNull();
    expect(within(credits).getByText("Director")).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Manage in Library" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Manage Cowboy Bebop" }),
    ).not.toBeNull();
    expect(globalThis.location.hash).toBe("#catalog/kitsu/anime/46474");
  });

  it("offers an add flow and explicit fallbacks for incomplete catalog metadata", async () => {
    const result = {
      provider: "kitsu",
      providerId: "99",
      providerUrl: "https://kitsu.io/anime/99",
      type: "anime",
      title: "Unknown Journey",
      coverUrl: "https://images.example.com/missing.jpg",
      genres: ["Mystery"],
      credits: [{ name: "Example Studio", role: "Studio" }],
      releaseStatus: "upcoming",
      startDate: "2027",
      durationMinutes: 24,
      catalogTotal: 12,
      communityRating: 7.5,
    };
    globalThis.sessionStorage.setItem(
      "honne:catalog:kitsu:anime:99",
      JSON.stringify(result),
    );
    globalThis.history.replaceState(null, "", "/#catalog/kitsu/anime/99");
    const router = createFetchRouter();
    let submitted: Record<string, unknown> | undefined;
    bootstrap(router, []);
    router.json("POST", "/api/media", async (request: Request) => {
      submitted = await request.json() as Record<string, unknown>;
      return Response.json({
        ...submitted,
        id: 4,
        createdAt: "2026-01-05T00:00:00Z",
        updatedAt: "2026-01-05T00:00:00Z",
      }, { status: 201 });
    });
    const user = userEvent.setup();
    render(<App />);

    const cover = await screen.findByRole("img", {
      name: "Unknown Journey cover",
    });
    fireEvent.error(cover);
    expect(
      screen.getByRole("img", {
        name: "No cover available for Unknown Journey",
      }),
    ).not.toBeNull();
    expect(
      screen.getByText("No synopsis is available from this provider."),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Add to Library" }));
    const dialog = screen.getByRole("dialog", { name: "Add media" });
    expect(
      (within(dialog).getByRole("textbox", {
        name: "Title",
      }) as HTMLInputElement)
        .value,
    ).toBe("Unknown Journey");
    expect(
      (within(dialog).getByRole("combobox", {
        name: /Type/,
      }) as HTMLSelectElement)
        .disabled,
    ).toBe(true);
    await user.click(
      within(dialog).getByRole("button", { name: "Add to collection" }),
    );
    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toMatchObject({
      title: "Unknown Journey",
      genres: ["Mystery"],
      credits: [{ name: "Example Studio", role: "Studio" }],
      releaseStatus: "upcoming",
      startDate: "2027",
      durationMinutes: 24,
      catalogTotal: 12,
      communityRating: 7.5,
    });
  });
});
