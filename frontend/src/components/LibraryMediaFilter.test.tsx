import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookOpen, Sparkles } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { LibraryMediaFilter } from "./LibraryMediaFilter.tsx";

const options = [
  {
    value: "anime" as const,
    label: "Anime",
    jpLabel: "アニメ",
    icon: Sparkles,
  },
  { value: "book" as const, label: "Books", jpLabel: "本", icon: BookOpen },
];
const items = [
  { type: "anime", coverUrl: "https://images.example.test/anime.jpg" },
  { type: "book", coverUrl: "" },
];

describe("Library media filter", () => {
  it("retains category names, counts, cover previews, pressed state, and native keyboard operation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <LibraryMediaFilter
        items={items}
        options={options}
        activeType="all"
        onChange={onChange}
      />,
    );
    const filter = screen.getByRole("region", { name: "Media type filters" });
    const all = within(filter).getByRole("button", { name: "All media 2" });
    const anime = within(filter).getByRole("button", {
      name: "Anime アニメ · 1",
    });
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(anime.style.backgroundImage).toContain(
      "https://images.example.test/anime.jpg",
    );
    all.focus();
    await user.tab();
    expect(document.activeElement).toBe(anime);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("anime");
    rerender(
      <LibraryMediaFilter
        items={items}
        options={options}
        activeType="anime"
        onChange={onChange}
      />,
    );
    expect(anime.getAttribute("aria-pressed")).toBe("true");
    expect(all.getAttribute("aria-pressed")).toBe("false");
    await user.tab();
    const books = within(filter).getByRole("button", { name: "Books 本 · 1" });
    expect(document.activeElement).toBe(books);
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith("book");
    await user.click(all);
    expect(onChange).toHaveBeenLastCalledWith("all");
  });

  it("retains zero-count categories and updates totals when Library data changes", () => {
    const { rerender } = render(
      <LibraryMediaFilter
        items={[]}
        options={options}
        activeType="all"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "All media 0" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Anime アニメ · 0" }).hasAttribute(
        "disabled",
      ),
    ).toBe(false);
    rerender(
      <LibraryMediaFilter
        items={items}
        options={options}
        activeType="all"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "All media 2" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Books 本 · 1" })).not.toBeNull();
  });

  it("rejects unsafe and credential-bearing cover URLs and finds the next valid preview", () => {
    render(
      <LibraryMediaFilter
        options={options}
        activeType="all"
        onChange={vi.fn()}
        items={[
          { type: "anime", coverUrl: "javascript:alert(1)" },
          {
            type: "anime",
            coverUrl: "https://user:secret@images.example.test/private.jpg",
          },
          { type: "anime", coverUrl: "https://images.example.test/safe.jpg" },
          { type: "book", coverUrl: "data:image/svg+xml,<svg/>" },
        ]}
      />,
    );
    const anime = screen.getByRole("button", { name: "Anime アニメ · 3" });
    expect(anime.style.backgroundImage).toContain(
      "https://images.example.test/safe.jpg",
    );
    expect(anime.style.backgroundImage).not.toContain("secret");
    expect(
      screen.getByRole("button", { name: "Books 本 · 1" }).style
        .backgroundImage,
    ).toBe("");
  });
});
