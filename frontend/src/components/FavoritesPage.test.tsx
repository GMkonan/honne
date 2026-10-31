import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavoritesPage } from "./FavoritesPage.tsx";
import * as favoritesImage from "../services/favoritesImage.ts";

const items = [
  { id: 2, title: "Second", coverUrl: "", type: "book" },
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
  it("keeps the empty state and does not offer an empty download", () => {
    render(<FavoritesPage items={[]} onOpen={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Your 3×3 is waiting" })).not
      .toBeNull();
    expect(screen.queryByRole("button", { name: "Download PNG" })).toBeNull();
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
    render(<FavoritesPage items={items} onOpen={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Download PNG" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(create).toHaveBeenCalledWith(items, expect.any(AbortSignal));
    expect(filename).toBe("honne-favorites-3x3.png");
    expect(screen.getByRole("status").textContent).toBe(
      "Favorites downloaded.",
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
    render(<FavoritesPage items={items} onOpen={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Download PNG" }));
    const working = screen.getByRole("button", { name: "Creating…" });
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
    render(<FavoritesPage items={items} onOpen={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Download PNG" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please try again",
    );
    expect(screen.getByRole("button", { name: "Open favorite 1: Second" })).not
      .toBeNull();
    await user.click(screen.getByRole("button", { name: "Download PNG" }));
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
      <FavoritesPage items={items} onOpen={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Download PNG" }));
    rerender(<FavoritesPage items={[...items].reverse()} onOpen={vi.fn()} />);
    expect(signals[0].aborted).toBe(true);
    finishes[0](result);
    await user.click(screen.getByRole("button", { name: "Download PNG" }));
    unmount();
    expect(signals[1].aborted).toBe(true);
    finishes[1](result);
    await waitFor(() => expect(URL.createObjectURL).not.toHaveBeenCalled());
  });
});
