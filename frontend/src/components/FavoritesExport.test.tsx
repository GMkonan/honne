import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavoritesExport } from "./FavoritesExport.tsx";
import { FavoritesPickerModal } from "./FavoritesPickerModal.tsx";
import * as favoritesImage from "../services/favoritesImage.ts";

const items = [
  { id: 2, title: "Second", coverUrl: "", type: "anime" },
  { id: 1, title: "First", coverUrl: "", type: "anime" },
];
const result = {
  blob: new Blob(["PNG"], { type: "image/png" }),
  missingCovers: 0,
};
const NativeURL = URL;

beforeEach(() => {
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:favorites");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("favorites export actions", () => {
  it("exports only the selected category in its saved order and uses distinct filenames", async () => {
    const create = vi.spyOn(favoritesImage, "createFavoritesImage")
      .mockResolvedValue(result);
    const book = { id: 3, title: "Book", type: "book", coverUrl: "" };
    const filenames: string[] = [];
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(
      function (this: HTMLAnchorElement) {
        filenames.push(this.download);
      },
    );
    const user = userEvent.setup();
    render(
      <FavoritesPickerModal
        mode="top_nine"
        items={[...items, book]}
        favoriteMediaIds={[1, 3, 2]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Download Anime 3×3 PNG" }),
    );
    await user.click(screen.getByRole("button", { name: "Books" }));
    await user.click(
      screen.getByRole("button", { name: "Download Books 3×3 PNG" }),
    );
    expect(create).toHaveBeenNthCalledWith(
      1,
      [items[1], items[0]],
      expect.any(AbortSignal),
      "Anime",
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      [book],
      expect.any(AbortSignal),
      "Books",
    );
    expect(filenames).toEqual([
      "honne-top-nine-anime-3x3.png",
      "honne-top-nine-book-3x3.png",
    ]);
  });

  it("keeps the empty state and does not offer an empty download", () => {
    render(<FavoritesExport items={[]} mediaType="anime" label="Anime" />);
    expect(
      screen.queryByRole("button", { name: "Download Anime 3×3 PNG" }),
    ).toBeNull();
  });

  it("downloads in saved order by keyboard and revokes the blob URL", async () => {
    const create = vi.spyOn(favoritesImage, "createFavoritesImage")
      .mockResolvedValue(result);
    let filename = "";
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(
      function (this: HTMLAnchorElement) {
        filename = this.download;
      },
    );
    const user = userEvent.setup();
    render(<FavoritesExport items={items} mediaType="anime" label="Anime" />);
    const button = screen.getByRole("button", {
      name: "Download Anime 3×3 PNG",
    });
    button.focus();
    await user.keyboard("{Enter}");
    expect(create).toHaveBeenCalledWith(
      items,
      expect.any(AbortSignal),
      "Anime",
    );
    expect(filename).toBe("honne-top-nine-anime-3x3.png");
    expect(screen.getByRole("status").textContent).toBe(
      "3×3 downloaded.",
    );
    await waitFor(() =>
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:favorites")
    );
  });

  it("blocks overlapping exports and explains missing covers", async () => {
    let finish: (value: typeof result) => void = () => {};
    const create = vi.spyOn(favoritesImage, "createFavoritesImage")
      .mockImplementation(() => new Promise((resolve) => finish = resolve));
    const user = userEvent.setup();
    render(<FavoritesExport items={items} mediaType="anime" label="Anime" />);
    await user.click(
      screen.getByRole("button", { name: "Download Anime 3×3 PNG" }),
    );
    const working = screen.getByRole("button", {
      name: "Download Anime 3×3 PNG",
    });
    expect(working.hasAttribute("disabled")).toBe(true);
    fireEvent.click(working);
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("Creating");
    finish({ ...result, missingCovers: 1 });
    expect(await screen.findByText(/1 cover was unavailable/u)).not.toBeNull();
  });

  it("shows an actionable error and retries without losing the grid", async () => {
    const create = vi.spyOn(favoritesImage, "createFavoritesImage")
      .mockRejectedValueOnce(
        new Error("Image export failed. Please try again."),
      )
      .mockResolvedValue(result);
    const user = userEvent.setup();
    render(<FavoritesExport items={items} mediaType="anime" label="Anime" />);
    await user.click(
      screen.getByRole("button", { name: "Download Anime 3×3 PNG" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please try again",
    );
    expect(screen.getByRole("button", { name: "Download Anime 3×3 PNG" }))
      .not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Download Anime 3×3 PNG" }),
    );
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cancels obsolete work on reorder and unmount without downloading stale data", async () => {
    const finishes: Array<(value: typeof result) => void> = [];
    const signals: AbortSignal[] = [];
    vi.spyOn(favoritesImage, "createFavoritesImage").mockImplementation(
      (_items, signal) => {
        signals.push(signal);
        return new Promise((resolve) => finishes.push(resolve));
      },
    );
    const user = userEvent.setup();
    const { rerender, unmount } = render(
      <FavoritesExport items={items} mediaType="anime" label="Anime" />,
    );
    await user.click(
      screen.getByRole("button", { name: "Download Anime 3×3 PNG" }),
    );
    rerender(
      <FavoritesExport
        items={[...items].reverse()}
        mediaType="anime"
        label="Anime"
      />,
    );
    expect(signals[0].aborted).toBe(true);
    finishes[0](result);
    await user.click(
      screen.getByRole("button", { name: "Download Anime 3×3 PNG" }),
    );
    unmount();
    expect(signals[1].aborted).toBe(true);
    finishes[1](result);
    await waitFor(() => expect(URL.createObjectURL).not.toHaveBeenCalled());
  });
});
