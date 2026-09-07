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

  it("downloads a restorable backup from Settings", async () => {
    globalThis.history.replaceState(null, "", "/#settings");
    const router = createFetchRouter();
    bootstrap(router);
    router.json(
      "GET",
      "/api/backup",
      () =>
        new Response('{"version":2,"items":[]}', {
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
    expect(within(personal).getByText("In progress")).not.toBeNull();
    expect(within(personal).getByText("8 of 26")).not.toBeNull();
    expect(within(personal).getByText("9/10")).not.toBeNull();

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
      name: "Current progress 26 total",
    });
    await user.clear(progress);
    await user.type(progress, "26");
    const rating = screen.getByRole("spinbutton", {
      name: "Personal rating Use 0 to leave this title unrated.",
    });
    await user.clear(rating);
    await user.type(rating, "10");
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
