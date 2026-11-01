import { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FavoritesPanel } from "./FavoritesPanel.tsx";
import type { FavoriteCandidate } from "../favoritesModel.ts";

const items: FavoriteCandidate[] = [
  { id: 1, title: "Cowboy Bebop", type: "anime", coverUrl: "" },
  { id: 2, title: "Dune", type: "book", coverUrl: "" },
  { id: 3, title: "Akira", type: "anime", coverUrl: "" },
];

function Harness(
  { initial = [], candidates = items, onSave = () => Promise.resolve() }: {
    initial?: number[];
    candidates?: FavoriteCandidate[];
    onSave?: (ids: number[], signal: AbortSignal) => Promise<void>;
  },
) {
  const [ids, setIds] = useState(initial);
  return (
    <FavoritesPanel
      items={candidates}
      favoriteMediaIds={ids}
      loading={false}
      error=""
      onRetry={vi.fn()}
      onOpen={vi.fn()}
      onSave={async (next, signal) => {
        await onSave(next, signal);
        if (!signal.aborted) setIds(next);
      }}
    />
  );
}

describe("Library favorites", () => {
  it("preserves selections across categories, waits for confirmation, and retries failed saves", async () => {
    let finish = () => {};
    const save = vi.fn<(ids: number[], signal: AbortSignal) => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("Could not save favorites. Please retry."),
      )
      .mockImplementationOnce(() =>
        new Promise<void>((resolve) => finish = resolve)
      );
    const user = userEvent.setup();
    render(<Harness onSave={save} />);
    const trigger = screen.getByRole("button", { name: "Choose favorites" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const category = screen.getByRole("combobox", {
      name: "Favorite media type",
    });
    expect(document.activeElement).toBe(category);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Title to add to favorites" }),
      "1",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.selectOptions(category, "book");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Title to add to favorites" }),
      "2",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Save favorites" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Please retry",
    );
    expect(
      within(screen.getByRole("list", { name: "Favorite order" })).getByText(
        "Dune",
      ),
    ).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Books favorites" }))
      .toBeNull();
    await user.selectOptions(category, "anime");
    expect(
      within(screen.getByRole("list", { name: "Favorite order" })).getByText(
        "Cowboy Bebop",
      ),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Save favorites" }));
    const saving = screen.getByRole("button", { name: "Saving…" });
    expect(saving.hasAttribute("disabled")).toBe(true);
    expect(category.hasAttribute("disabled")).toBe(true);
    fireEvent.click(saving);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith([1, 2], expect.any(AbortSignal));
    expect(
      screen.queryByRole("button", { name: "Open favorite 1: Cowboy Bebop" }),
    ).toBeNull();
    finish();
    expect(await screen.findByText("Favorites saved in this order.")).not
      .toBeNull();
    expect(
      screen.getByRole("button", { name: "Open favorite 1: Cowboy Bebop" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open favorite 1: Dune" })).not
      .toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("limits each type to nine without blocking another category", async () => {
    const anime = Array.from(
      { length: 10 },
      (_, index) => ({
        id: index + 10,
        title: `Anime ${index + 1}`,
        type: "anime",
        coverUrl: "",
      }),
    );
    const save = vi.fn(() => Promise.resolve());
    const ids = anime.slice(0, 9).map((item) => item.id);
    const user = userEvent.setup();
    render(
      <Harness candidates={[...anime, items[1]]} initial={ids} onSave={save} />,
    );
    await user.click(screen.getByRole("button", { name: "Edit favorites" }));
    const picker = screen.getByRole("combobox", {
      name: "Title to add to favorites",
    });
    expect(picker.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("9 / 9 in this category")).not.toBeNull();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Favorite media type" }),
      "book",
    );
    expect(picker.hasAttribute("disabled")).toBe(false);
    await user.selectOptions(picker, "2");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Save favorites" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([...ids, 2], expect.any(AbortSignal))
    );
    expect(screen.getAllByRole("button", { name: /^Open favorite/u }))
      .toHaveLength(10);
  });

  it("reorders within a category and preserves the others", async () => {
    const save = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(<Harness initial={[2, 3, 1]} onSave={save} />);
    await user.click(screen.getByRole("button", { name: "Edit favorites" }));
    const move = screen.getByRole("button", {
      name: "Move Cowboy Bebop earlier",
    });
    move.focus();
    await user.keyboard("{Enter}");
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save favorites" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([2, 1, 3], expect.any(AbortSignal))
    );
  });

  it("discards removals without writing and restores keyboard focus", async () => {
    const save = vi.fn(() => Promise.resolve());
    const user = userEvent.setup();
    render(<Harness initial={[1]} onSave={save} />);
    const trigger = screen.getByRole("button", { name: "Edit favorites" });
    await user.click(trigger);
    await user.click(
      screen.getByRole("button", {
        name: "Remove Cowboy Bebop from favorites",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    expect(
      screen.getByRole("button", { name: "Open favorite 1: Cowboy Bebop" }),
    ).not.toBeNull();
    await user.click(trigger);
    expect(
      screen.getByRole("button", {
        name: "Remove Cowboy Bebop from favorites",
      }),
    ).not.toBeNull();
  });

  it("opens a saved favorite by keyboard and labels category downloads", async () => {
    const open = vi.fn();
    const user = userEvent.setup();
    render(
      <FavoritesPanel
        items={items}
        favoriteMediaIds={[2, 1]}
        loading={false}
        error=""
        onRetry={vi.fn()}
        onSave={vi.fn()}
        onOpen={open}
      />,
    );
    const book = screen.getByRole("button", { name: "Open favorite 1: Dune" });
    book.focus();
    await user.keyboard("{Enter}");
    expect(open).toHaveBeenCalledWith(2);
    expect(screen.getByRole("button", { name: "Download Anime favorites PNG" }))
      .not.toBeNull();
    expect(screen.getByRole("button", { name: "Download Books favorites PNG" }))
      .not.toBeNull();
    expect(screen.queryByRole("region", { name: "Games favorites" }))
      .toBeNull();
  });

  it("cancels a pending save on unmount without publishing obsolete feedback", async () => {
    let finish = () => {};
    const save = vi.fn((_ids: number[], _signal: AbortSignal) =>
      new Promise<void>((resolve) => finish = resolve)
    );
    const user = userEvent.setup();
    const { unmount } = render(<Harness initial={[1, 3]} onSave={save} />);
    await user.click(screen.getByRole("button", { name: "Edit favorites" }));
    await user.click(
      screen.getByRole("button", { name: "Remove Akira from favorites" }),
    );
    await user.click(screen.getByRole("button", { name: "Save favorites" }));
    const signal = save.mock.calls[0][1];
    unmount();
    expect(signal.aborted).toBe(true);
    finish();
    await waitFor(() =>
      expect(screen.queryByText("Favorites saved in this order.")).toBeNull()
    );
  });

  it("keeps title fallbacks for missing, unsafe, and failed covers", () => {
    const candidates = [
      { ...items[0], coverUrl: "https://images.example.test/cover.png" },
      { ...items[1], coverUrl: "javascript:alert(1)" },
      {
        ...items[2],
        coverUrl: "https://user:secret@images.example.test/cover.png",
      },
    ];
    render(<Harness candidates={candidates} initial={[1, 2, 3]} />);
    const first = screen.getByRole("button", {
      name: "Open favorite 1: Cowboy Bebop",
    });
    const image = within(first).getByRole("presentation");
    expect(image.getAttribute("loading")).toBe("lazy");
    fireEvent.error(image);
    expect(within(first).queryByRole("presentation")).toBeNull();
    expect(within(first).getByText("Cowboy Bebop")).not.toBeNull();
    expect(screen.queryAllByRole("presentation")).toHaveLength(0);
  });

  it("removes deleted Library titles from an open draft without losing other edits", async () => {
    const save = vi.fn(() => Promise.resolve());
    const props = {
      items,
      favoriteMediaIds: [1, 3],
      loading: false,
      error: "",
      onRetry: vi.fn(),
      onOpen: vi.fn(),
      onSave: save,
    };
    const user = userEvent.setup();
    const { rerender } = render(<FavoritesPanel {...props} />);
    await user.click(screen.getByRole("button", { name: "Edit favorites" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Favorite media type" }),
      "book",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Title to add to favorites" }),
      "2",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    rerender(
      <FavoritesPanel
        {...props}
        items={items.filter((item) => item.id !== 1)}
        favoriteMediaIds={[3]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save favorites" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([3, 2], expect.any(AbortSignal))
    );
  });
});
