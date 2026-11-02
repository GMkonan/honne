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

function metric(panel: HTMLElement, label: string): string | null | undefined {
  return within(panel).getByText(label).parentElement?.querySelector("dd")
    ?.textContent;
}

describe("Genre stats panel", () => {
  it("shows the completed-only distribution, overlapping percentages, and consumption above a calculation explanation", async () => {
    const user = userEvent.setup();
    render(
      <GenreStatsPanel
        items={[
          anime,
          { ...anime, genres: ["Comedy", "Action"] },
          { ...anime, genres: [] },
          { ...anime, status: "in_progress", genres: ["Horror"] },
        ]}
        loading={false}
        error=""
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
    expect(rows[0].textContent).toContain("67%Comedy, 2 of 3 completed titles");
    expect(within(legend).queryByText("Horror")).toBeNull();
    expect(metric(panel, "Completed")).toBe("3");
    expect(metric(panel, "Episodes recorded")).toBe("36");
    expect(metric(panel, "Estimated watch time")).toBe("14h 24m");
    expect(
      within(panel).getByText("Genres available for 2 of 3 completed titles."),
    )
      .not.toBeNull();
    const method = within(panel).getByText("How this is calculated");
    await user.click(method);
    expect(method.parentElement?.hasAttribute("open")).toBe(true);
    expect(within(panel).getByText(/percentages may add up to more than 100%/u))
      .not.toBeNull();
  });

  it("supports category tabs with arrows, wrapping, Home and End, keeping categories isolated", async () => {
    const user = userEvent.setup();
    render(
      <GenreStatsPanel
        items={[
          anime,
          { ...anime, type: "manga", genres: ["Drama"], progress: 30 },
          {
            ...anime,
            type: "game",
            genres: ["Adventure"],
            playtimeMinutes: 90,
          },
        ]}
        loading={false}
        error=""
      />,
    );
    const tabs = screen.getByRole("tablist", { name: "Statistics categories" });
    const animeTab = within(tabs).getByRole("tab", { name: "Anime" });
    animeTab.focus();
    await user.keyboard("{ArrowRight}");
    const mangaTab = within(tabs).getByRole("tab", { name: "Manga" });
    expect(document.activeElement).toBe(mangaTab);
    expect(mangaTab.getAttribute("aria-selected")).toBe("true");
    expect(animeTab.tabIndex).toBe(-1);
    let panel = screen.getByRole("tabpanel", { name: "Manga" });
    expect(metric(panel, "Chapters recorded")).toBe("30");
    expect(within(panel).queryByText("Estimated watch time")).toBeNull();
    expect(screen.queryByRole("list", { name: "Anime genres" })).toBeNull();
    await user.keyboard("{End}");
    panel = screen.getByRole("tabpanel", { name: "Games" });
    expect(metric(panel, "Recorded playtime")).toBe("1h 30m");
    expect(within(panel).queryByText("Episodes recorded")).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(animeTab);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(
      within(tabs).getByRole("tab", { name: "Games" }),
    );
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(animeTab);
    await user.click(mangaTab);
    expect(screen.getByRole("tabpanel", { name: "Manga" })).not.toBeNull();
  });

  it("selects a completed category initially and falls back when its last title is removed", async () => {
    const user = userEvent.setup();
    const items = [{ ...anime, status: "planned" }, {
      ...anime,
      type: "manga",
    }];
    const { rerender } = render(
      <GenreStatsPanel items={items} loading={false} error="" />,
    );
    expect(screen.getByRole("tabpanel", { name: "Manga" })).not.toBeNull();
    await user.click(screen.getByRole("tab", { name: "Anime" }));
    expect(screen.getByText("No completed titles in this category yet."))
      .not.toBeNull();
    expect(screen.queryByText("Episodes recorded")).toBeNull();
    rerender(<GenreStatsPanel items={[items[1]]} loading={false} error="" />);
    expect(screen.getByRole("tabpanel", { name: "Manga" })).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "Anime" })).toBeNull();
  });

  it("distinguishes initial loading, empty data, load failure, and refresh failure with retained data", () => {
    const { rerender } = render(
      <GenreStatsPanel items={[]} loading error="" />,
    );
    expect(screen.getByRole("status").textContent).toBe("Loading genre stats…");
    expect(screen.queryByText("Complete a title to see your genre stats."))
      .toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<GenreStatsPanel items={[]} loading={false} error="" />);
    expect(screen.getByText("Complete a title to see your genre stats."))
      .not.toBeNull();
    rerender(
      <GenreStatsPanel items={[]} loading={false} error="Unavailable" />,
    );
    expect(screen.getByText(/Genre stats are unavailable/u)).not.toBeNull();
    expect(screen.queryByText("Complete a title to see your genre stats."))
      .toBeNull();
    rerender(<GenreStatsPanel items={[anime]} loading error="" />);
    expect(screen.getByRole("status").textContent).toBe(
      "Refreshing genre stats…",
    );
    expect(screen.getByRole("img")).not.toBeNull();
    rerender(
      <GenreStatsPanel
        items={[anime]}
        loading={false}
        error="Refresh failed"
      />,
    );
    expect(screen.getByRole("img")).not.toBeNull();
    expect(screen.queryByText(/Genre stats are unavailable/u)).toBeNull();
  });

  it("preserves consumption without genre metadata and marks missing progress and runtime instead of fabricating zeros", () => {
    render(
      <GenreStatsPanel
        items={[{
          ...anime,
          genres: undefined,
          progress: 0,
          durationMinutes: 0,
        }]}
        loading={false}
        error=""
      />,
    );
    const panel = screen.getByRole("region", { name: "Genre stats" });
    expect(
      within(panel).getByText("No genre metadata for completed titles yet."),
    )
      .not.toBeNull();
    expect(within(panel).queryByRole("img")).toBeNull();
    expect(metric(panel, "Completed")).toBe("1");
    expect(metric(panel, "Episodes recorded")).toBe("Not tracked");
    expect(metric(panel, "Estimated watch time")).toBe("Unavailable");
    expect(
      within(panel).getByText("Progress is missing for 1 completed title."),
    )
      .not.toBeNull();
    expect(within(panel).getByText(/Watch time is incomplete for 1 of 1/u))
      .not.toBeNull();
  });

  it("reports partial repeat and playtime coverage in the corresponding categories", async () => {
    const user = userEvent.setup();
    render(
      <GenreStatsPanel
        items={[
          { ...anime, repeatCount: 2, total: 0 },
          { ...anime, type: "game", playtimeMinutes: 0 },
        ]}
        loading={false}
        error=""
      />,
    );
    expect(screen.getByText(/Some completed repeats have no known length/u))
      .not.toBeNull();
    await user.click(screen.getByRole("tab", { name: "Games" }));
    const panel = screen.getByRole("tabpanel", { name: "Games" });
    expect(metric(panel, "Recorded playtime")).toBe("Not tracked");
    expect(within(panel).getByText("Playtime is missing for 1 completed game."))
      .not.toBeNull();
  });

  it("keeps every genre and long untrusted labels as accessible text, with a keyboard-scrollable legend", () => {
    const genres = [
      '<img src=x onerror="alert(1)">',
      "A very long genre name that should wrap rather than enlarge the page",
      ...Array.from({ length: 10 }, (_, index) => `Genre ${index + 1}`),
    ];
    render(
      <GenreStatsPanel
        items={[{ ...anime, genres }]}
        loading={false}
        error=""
      />,
    );
    const legend = screen.getByRole("list", { name: "Anime genres" });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(12);
    expect(legend.tabIndex).toBe(0);
    expect(legend.textContent).toContain(genres[0]);
    expect(legend.querySelector("img")).toBeNull();
    expect(screen.getByText("Scroll the legend to see all 12 genres."))
      .not.toBeNull();
  });
});
