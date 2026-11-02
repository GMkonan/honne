import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createFetchRouter } from "../test/fetch-router.ts";
import { FavoritesPanel } from "./FavoritesPanel.tsx";

const anime = Array.from(
  { length: 10 },
  (_, index) => ({
    id: index + 1,
    title: `Anime ${index + 1}`,
    type: "anime",
    coverUrl: "",
  }),
);
const book = { id: 11, title: "Book", type: "book", coverUrl: "" };
const nonFavorite = {
  id: 12,
  title: "Not a favorite",
  type: "anime",
  coverUrl: "",
};
const defaults = {
  items: [...anime, book, nonFavorite],
  favoriteMediaIds: [...anime.map((item) => item.id), book.id],
  loading: false,
  error: "",
  onRetry: vi.fn(),
  onOpen: vi.fn(),
  onSave: vi.fn(),
};

describe("independent 3×3 and favorites", () => {
  it("previews eight covers, expands the category, and supports keyboard category navigation", async () => {
    const user = userEvent.setup();
    render(<FavoritesPanel {...defaults} />);
    expect(
      screen.queryByText(
        "Handpicked from your Library. Up to nine per media type.",
      ),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Open favorite/u }))
      .toHaveLength(8);
    await user.click(screen.getByRole("button", { name: "Show more (2)" }));
    expect(screen.getAllByRole("button", { name: /^Open favorite/u }))
      .toHaveLength(10);
    await user.click(screen.getByRole("button", { name: "Show less" }));
    expect(screen.getAllByRole("button", { name: /^Open favorite/u }))
      .toHaveLength(8);
    const animeTab = screen.getByRole("tab", { name: "Anime" });
    animeTab.focus();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Games" }),
    );
    expect(
      screen.getByRole("tab", { name: "Games" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: /^Open favorite/u }))
      .toBeNull();
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(animeTab);
    await user.click(screen.getByRole("tab", { name: "Books" }));
    expect(screen.getByRole("button", { name: "Open favorite 1: Book" })).not
      .toBeNull();
  });

  it("chooses only favorites, enforces nine only in 3×3, and saves independently before exporting", async () => {
    const router = createFetchRouter();
    router.json("GET", "/api/top-nine", {
      mediaIds: anime.slice(0, 9).map((item) => item.id),
    });
    let saved: number[] = [];
    router.json("PUT", "/api/top-nine", async (request: Request) => {
      const body = await request.json() as { mediaIds: number[] };
      saved = body.mediaIds;
      return Response.json(body);
    });
    vi.stubGlobal("fetch", router.fetch);
    const saveFavorites = vi.fn();
    const user = userEvent.setup();
    render(<FavoritesPanel {...defaults} onSave={saveFavorites} />);
    const trigger = screen.getByRole("button", { name: "Build 3×3" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: "Build your 3×3",
    });
    expect(
      within(dialog).queryByRole("button", {
        name: "Select Not a favorite for 3×3",
      }),
    ).toBeNull();
    const tenth = within(dialog).getByRole("button", {
      name: "Select Anime 10 for 3×3",
    });
    expect(tenth.hasAttribute("disabled")).toBe(true);
    expect(
      within(dialog).getByRole("button", { name: "Download Anime 3×3 PNG" })
        .hasAttribute("disabled"),
    ).toBe(false);
    await user.click(
      within(dialog).getByRole("button", { name: "Select Anime 1 for 3×3" }),
    );
    await user.click(tenth);
    expect(
      within(dialog).getByRole("button", { name: "Download Anime 3×3 PNG" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await user.click(
      within(dialog).getByRole("button", { name: "Move Anime 10 earlier" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Books" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Select Book for 3×3" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save 3×3" }));
    expect(
      await within(dialog).findByText("3×3 selection saved in this order."),
    ).not.toBeNull();
    expect(saved).toEqual([2, 3, 4, 5, 6, 7, 8, 10, 9, 11]);
    expect(saveFavorites).not.toHaveBeenCalled();
    expect(
      within(dialog).getByRole("button", { name: "Download Books 3×3 PNG" })
        .hasAttribute("disabled"),
    ).toBe(false);
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
    expect(screen.getAllByRole("button", { name: /^Open favorite/u }))
      .toHaveLength(8);
  });

  it("keeps favorites usable after a failed 3×3 load and retries safely", async () => {
    const router = createFetchRouter();
    router.json("GET", "/api/top-nine", { error: "3×3 unavailable" }, 503);
    vi.stubGlobal("fetch", router.fetch);
    const user = userEvent.setup();
    render(<FavoritesPanel {...defaults} />);
    await user.click(screen.getByRole("button", { name: "Build 3×3" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "3×3 unavailable",
    );
    expect(screen.getAllByRole("button", { name: /^Open favorite/u }))
      .toHaveLength(8);
    expect(
      screen.getByRole("button", { name: "Edit favorites" }).hasAttribute(
        "disabled",
      ),
    ).toBe(false);
    router.json("GET", "/api/top-nine", { mediaIds: [] });
    await user.click(screen.getByRole("button", { name: "Retry 3×3" }));
    expect(await screen.findByRole("dialog", { name: "Build your 3×3" })).not
      .toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Download.*3×3 PNG/u }))
      .toBeNull();
  });

  it("retains a failed 3×3 save draft and retries without writing favorites", async () => {
    const router = createFetchRouter();
    router.json("GET", "/api/top-nine", { mediaIds: [] });
    router.json("PUT", "/api/top-nine", { error: "Could not save 3×3" }, 500);
    vi.stubGlobal("fetch", router.fetch);
    const saveFavorites = vi.fn();
    const user = userEvent.setup();
    render(<FavoritesPanel {...defaults} onSave={saveFavorites} />);
    await user.click(screen.getByRole("button", { name: "Build 3×3" }));
    await screen.findByRole("dialog", { name: "Build your 3×3" });
    const cover = screen.getByRole("button", {
      name: "Select Anime 10 for 3×3",
    });
    await user.click(cover);
    await user.click(screen.getByRole("button", { name: "Save 3×3" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not save 3×3",
    );
    expect(cover.getAttribute("aria-pressed")).toBe("true");
    router.json("PUT", "/api/top-nine", { mediaIds: [10] });
    await user.click(screen.getByRole("button", { name: "Save 3×3" }));
    expect(await screen.findByText("3×3 selection saved in this order.")).not
      .toBeNull();
    expect(saveFavorites).not.toHaveBeenCalled();
  });

  it("cancels an obsolete load on unmount without opening a late modal", async () => {
    let signal: AbortSignal | undefined;
    let finish: (response: Response) => void = () => {};
    const router = createFetchRouter().json(
      "GET",
      "/api/top-nine",
      (request: Request) => {
        signal = request.signal;
        return new Promise<Response>((resolve) => finish = resolve);
      },
    );
    vi.stubGlobal("fetch", router.fetch);
    const user = userEvent.setup();
    const { unmount } = render(<FavoritesPanel {...defaults} />);
    await user.click(screen.getByRole("button", { name: "Build 3×3" }));
    expect(screen.getByText("Loading your 3×3…")).not.toBeNull();
    unmount();
    expect(signal?.aborted).toBe(true);
    finish(Response.json({ mediaIds: [1] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
