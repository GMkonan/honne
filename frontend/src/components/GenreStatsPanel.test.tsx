import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { GenreStatsMedia } from "../genreStats.ts";
import { GenreStatsPanel } from "./GenreStatsPanel.tsx";

const anime: GenreStatsMedia = {
  type: "anime",
  status: "completed",
  genres: ["Comedy", "Romance"],
  progress: 12,
  total: 12,
  durationMinutes: 24,
};

const defaults = { type: "anime" as const, loading: false, error: "" };

describe("Genre stats panel", () => {
  it("shows overlapping completed-only percentages without embedding consumption", async () => {
    const user = userEvent.setup();
    render(
      <GenreStatsPanel
        {...defaults}
        items={[
          anime,
          { ...anime, genres: ["Comedy", "Action"] },
          { ...anime, genres: [] },
          { ...anime, status: "in_progress", genres: ["Horror"] },
        ]}
      />,
    );
    const panel = screen.getByRole("region", { name: "Genre stats" });
    expect(within(panel).getByText("Completed only")).not.toBeNull();
    expect(
      within(panel).getByRole("img", {
        name: "Completed Anime genre distribution",
      }),
    ).not.toBeNull();
    const legend = within(panel).getByRole("list", { name: "Anime genres" });
    const rows = within(legend).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("67%")).not.toBeNull();
    expect(within(legend).queryByText("Horror")).toBeNull();
    expect(within(panel).queryByText("Episodes recorded")).toBeNull();
    expect(within(panel).queryByText("Estimated watch time")).toBeNull();
    expect(within(panel).getByText("Based on 3 completed titles.")).not
      .toBeNull();
    expect(
      within(panel).getByText("Genres available for 2 of 3 completed titles."),
    ).not.toBeNull();
    const method = within(panel).getByText("How this is calculated");
    await user.click(method);
    expect(method.parentElement?.hasAttribute("open")).toBe(true);
    expect(within(panel).getByText(/percentages may add up to more than 100%/u))
      .not.toBeNull();
  });

  it("follows the shared selected type and supports All media without local tabs", () => {
    const items = [anime, { ...anime, type: "manga", genres: ["Drama"] }, {
      ...anime,
      type: "game",
      genres: ["Adventure"],
    }];
    const { rerender } = render(
      <GenreStatsPanel {...defaults} items={items} />,
    );
    expect(screen.getByRole("list", { name: "Anime genres" }).textContent).not
      .toContain("Drama");
    rerender(<GenreStatsPanel {...defaults} items={items} type="manga" />);
    expect(screen.getByRole("list", { name: "Manga genres" }).textContent)
      .toContain("100%Drama");
    expect(screen.queryByRole("list", { name: "Anime genres" })).toBeNull();
    rerender(<GenreStatsPanel {...defaults} items={items} type="all" />);
    expect(
      screen.getByRole("img", {
        name: "Completed All media genre distribution",
      }),
    ).not.toBeNull();
    expect(screen.getByRole("list", { name: "All media genres" }).textContent)
      .toContain("33%Drama");
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("keeps the selected category empty when it has no completions or its last title is removed", () => {
    const items = [{ ...anime, status: "planned" }, {
      ...anime,
      type: "manga",
    }];
    const { rerender } = render(
      <GenreStatsPanel {...defaults} items={items} />,
    );
    expect(screen.getByText("No completed titles in this selection yet.")).not
      .toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<GenreStatsPanel {...defaults} items={[items[1]]} />);
    expect(screen.getByText("No completed titles in this selection yet.")).not
      .toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("distinguishes initial loading, empty data, failures, and refreshes with retained data", () => {
    const { rerender } = render(
      <GenreStatsPanel {...defaults} items={[]} loading />,
    );
    expect(screen.getByRole("status").textContent).toBe("Loading genre stats…");
    expect(screen.queryByText("Complete a title to see your genre stats."))
      .toBeNull();
    rerender(<GenreStatsPanel {...defaults} items={[]} />);
    expect(screen.getByText("Complete a title to see your genre stats.")).not
      .toBeNull();
    rerender(<GenreStatsPanel {...defaults} items={[]} error="Unavailable" />);
    expect(screen.getByText(/Genre stats are unavailable/u)).not.toBeNull();
    expect(screen.queryByText("Complete a title to see your genre stats."))
      .toBeNull();
    rerender(<GenreStatsPanel {...defaults} items={[anime]} loading />);
    expect(screen.getByRole("status").textContent).toBe(
      "Refreshing genre stats…",
    );
    expect(screen.getByRole("img")).not.toBeNull();
    rerender(
      <GenreStatsPanel {...defaults} items={[anime]} error="Refresh failed" />,
    );
    expect(screen.getByRole("img")).not.toBeNull();
    expect(screen.queryByText(/Genre stats are unavailable/u)).toBeNull();
  });

  it("reports missing genre metadata without fabricating a chart", () => {
    render(
      <GenreStatsPanel
        {...defaults}
        items={[{ ...anime, genres: undefined }]}
      />,
    );
    expect(screen.getByText("No genre metadata for completed titles yet.")).not
      .toBeNull();
    expect(screen.getByText("Genres available for 0 of 1 completed titles."))
      .not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("keeps all long and untrusted genre labels as accessible text in a keyboard-scrollable legend", () => {
    const genres = [
      '<img src=x onerror="alert(1)">',
      "A very long genre name that should wrap rather than enlarge the page",
      ...Array.from({ length: 10 }, (_, index) => `Genre ${index + 1}`),
    ];
    render(<GenreStatsPanel {...defaults} items={[{ ...anime, genres }]} />);
    const legend = screen.getByRole("list", { name: "Anime genres" });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(12);
    expect(legend.tabIndex).toBe(0);
    expect(legend.textContent).toContain(genres[0]);
    expect(legend.querySelector("img")).toBeNull();
    expect(screen.getByText("Scroll the legend to see all 12 genres.")).not
      .toBeNull();
  });
});
