import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { GenreStatsMedia } from "../genreStats.ts";
import { ConsumptionPanel } from "./ConsumptionPanel.tsx";

const anime: GenreStatsMedia = {
  type: "anime",
  status: "completed",
  progress: 12,
  total: 12,
  durationMinutes: 24,
  genres: ["Comedy"],
};
const defaults = { type: "anime" as const, loading: false, error: "" };
const metric = (panel: HTMLElement, label: string) =>
  within(panel).getByText(label).parentElement?.querySelector("dd")
    ?.textContent;

describe("Consumption card", () => {
  it("combines completed and ongoing progress, repeats, and estimated watch time without a genre chart", async () => {
    const user = userEvent.setup();
    render(
      <ConsumptionPanel
        {...defaults}
        items={[
          { ...anime, repeatCount: 1 },
          { ...anime, status: "in_progress", progress: 5 },
        ]}
      />,
    );
    const card = screen.getByRole("region", { name: "Consumption" });
    const group = within(card).getByRole("region", {
      name: "Anime consumption",
    });
    expect(within(group).queryByText("Completed")).toBeNull();
    expect(metric(group, "Episodes")).toBe("29");
    expect(metric(group, "Watch time")).toBe("Estimated ~11h 36m");
    expect(within(group).queryByText(/Based on/u)).toBeNull();
    expect(within(card).queryByText("Progress across all statuses")).toBeNull();
    expect(within(card).queryByRole("img")).toBeNull();
    const method = within(card).getByText("Details");
    expect(method.parentElement?.hasAttribute("open")).toBe(false);
    await user.click(method);
    expect(method.parentElement?.hasAttribute("open")).toBe(true);
    expect(
      screen.getByRole("region", { name: "Anime calculation details" })
        .textContent,
    ).toContain("2 titles, 1 completed.");
    expect(within(card).getByText(/not multiplied by replays/u)).not.toBeNull();
  });

  it.each(["manga", "anime", "series"] as const)(
    "shows 1,000 consumed units for an ongoing %s with 1,500 available, even without completions",
    (type) => {
      render(
        <ConsumptionPanel
          {...defaults}
          type={type}
          items={[{
            ...anime,
            type,
            status: "in_progress",
            progress: 1000,
            total: 1500,
          }]}
        />,
      );
      const group = screen.getByRole("region", { name: /consumption$/u });
      expect(within(group).queryByText("Completed")).toBeNull();
      expect(
        metric(
          group,
          type === "manga" ? "Chapters" : "Episodes",
        ),
      ).toBe("1,000");
      expect(within(group).queryByText(/Known totals are used/u)).toBeNull();
    },
  );

  it("keeps inferred-progress notes in collapsed details without changing saved progress", async () => {
    const user = userEvent.setup();
    const item = Object.freeze({
      ...anime,
      progress: 0,
      total: 12,
      catalogTotal: 24,
    });
    render(<ConsumptionPanel {...defaults} items={[item]} />);
    const group = screen.getByRole("region", { name: "Anime consumption" });
    expect(metric(group, "Episodes")).toBe("12");
    expect(within(group).queryByText(/Known totals/u)).toBeNull();
    const details = screen.getByText("Details");
    expect(details.parentElement?.hasAttribute("open")).toBe(false);
    await user.click(details);
    const notes = screen.getByRole("region", {
      name: "Anime calculation details",
    });
    expect(
      within(notes).getByText(
        "Known totals used for 1 completed title without progress.",
      ),
    ).not.toBeNull();
    expect(within(group).queryByText(/Progress is missing/u)).toBeNull();
    expect(item.progress).toBe(0);
  });

  it("labels watch time as partial when an included title lacks duration", () => {
    render(
      <ConsumptionPanel
        {...defaults}
        items={[anime, {
          ...anime,
          status: "in_progress",
          progress: 3,
          durationMinutes: undefined,
        }]}
      />,
    );
    const group = screen.getByRole("region", { name: "Anime consumption" });
    expect(metric(group, "Episodes")).toBe("15");
    expect(metric(group, "Watch time")).toBe("Estimated ~4h 48mPartial");
    expect(within(group).getByText("Partial")).not.toBeNull();
    expect(within(group).queryByText(/Watch time missing data/u)).toBeNull();
    expect(screen.getByText("Details").parentElement?.hasAttribute("open"))
      .toBe(false);
  });

  it("keeps all media types and units separate and follows the shared filter", () => {
    const items = [
      anime,
      { ...anime, type: "series", progress: 10, durationMinutes: 45 },
      { ...anime, type: "movie", repeatCount: 1, durationMinutes: 120 },
      { ...anime, type: "book", progress: 412 },
      { ...anime, type: "manga", progress: 30 },
      { ...anime, type: "light_novel", progress: 20 },
      { ...anime, type: "game", playtimeMinutes: 90, repeatCount: 5 },
    ];
    const { rerender } = render(
      <ConsumptionPanel {...defaults} items={items} type="all" />,
    );
    expect(
      metric(
        screen.getByRole("region", { name: "Anime consumption" }),
        "Episodes",
      ),
    ).toBe("12");
    expect(
      metric(
        screen.getByRole("region", { name: "Series consumption" }),
        "Watch time",
      ),
    ).toBe("Estimated ~7h 30m");
    expect(
      metric(
        screen.getByRole("region", { name: "Movies consumption" }),
        "Viewings",
      ),
    ).toBe("2");
    expect(
      metric(
        screen.getByRole("region", { name: "Books consumption" }),
        "Pages",
      ),
    ).toBe("412");
    expect(
      metric(
        screen.getByRole("region", { name: "Manga consumption" }),
        "Chapters",
      ),
    ).toBe("30");
    expect(
      metric(
        screen.getByRole("region", { name: "Light novels consumption" }),
        "Chapters",
      ),
    ).toBe("20");
    const game = screen.getByRole("region", { name: "Games consumption" });
    expect(metric(game, "Playtime")).toBe("1h 30m");
    expect(within(game).queryByText("Watch time")).toBeNull();
    rerender(<ConsumptionPanel {...defaults} items={items} type="game" />);
    expect(screen.getByRole("region", { name: "Games consumption" })).not
      .toBeNull();
    expect(screen.queryByRole("region", { name: "Anime consumption" }))
      .toBeNull();
    expect(screen.queryByText("Pages")).toBeNull();
  });

  it("keeps unavailable values explicit and moves missing-data explanations into details", async () => {
    const user = userEvent.setup();
    render(
      <ConsumptionPanel
        {...defaults}
        items={[
          {
            ...anime,
            genres: undefined,
            progress: 0,
            total: 0,
            repeatCount: 2,
            durationMinutes: 0,
          },
        ]}
      />,
    );
    const group = screen.getByRole("region", { name: "Anime consumption" });
    expect(metric(group, "Episodes")).toBe("Not tracked");
    expect(metric(group, "Watch time")).toBe("Unknown");
    expect(within(group).queryByText(/Progress missing/u)).toBeNull();
    await user.click(screen.getByText("Details"));
    const notes = screen.getByRole("region", {
      name: "Anime calculation details",
    });
    expect(
      within(notes).getByText("Progress missing for 1 completed title."),
    ).not.toBeNull();
    expect(
      within(notes).getByText("1 title has repeats with unknown length."),
    ).not.toBeNull();
    expect(
      within(notes).getByText("Watch time missing data for 1 of 1 title."),
    ).not
      .toBeNull();
  });

  it("reports missing game playtime in details without inventing zero hours", async () => {
    const user = userEvent.setup();
    render(
      <ConsumptionPanel
        {...defaults}
        type="game"
        items={[{ ...anime, type: "game", playtimeMinutes: 0 }]}
      />,
    );
    const group = screen.getByRole("region", { name: "Games consumption" });
    expect(metric(group, "Playtime")).toBe("Not tracked");
    expect(within(group).queryByText(/Playtime missing/u)).toBeNull();
    await user.click(screen.getByText("Details"));
    const notes = screen.getByRole("region", {
      name: "Games calculation details",
    });
    expect(within(notes).getByText("Playtime missing for 1 game."))
      .not.toBeNull();
  });

  it("keeps positive incomplete chapter totals visibly partial without expanding details", () => {
    render(
      <ConsumptionPanel
        {...defaults}
        type="manga"
        items={[
          { ...anime, type: "manga" },
          { ...anime, type: "manga", progress: 0, total: 0 },
        ]}
      />,
    );
    const group = screen.getByRole("region", { name: "Manga consumption" });
    expect(metric(group, "Chapters")).toBe("12Partial");
    expect(within(group).getByText("Partial")).not.toBeNull();
    expect(screen.getByText("Details").parentElement?.hasAttribute("open"))
      .toBe(false);
  });

  it("keeps positive incomplete game hours visibly partial without estimating missing playtime", () => {
    render(
      <ConsumptionPanel
        {...defaults}
        type="game"
        items={[
          { ...anime, type: "game", playtimeMinutes: 90 },
          { ...anime, type: "game", playtimeMinutes: 0 },
        ]}
      />,
    );
    const group = screen.getByRole("region", { name: "Games consumption" });
    expect(metric(group, "Playtime")).toBe("1h 30mPartial");
    expect(within(group).getByText("Partial")).not.toBeNull();
    expect(within(group).queryByText("Watch time")).toBeNull();
  });

  it("keeps native calculation details in the tab order and supports expand/collapse", async () => {
    const user = userEvent.setup();
    render(<ConsumptionPanel {...defaults} items={[anime]} />);
    const summary = screen.getByText("Details");
    await user.tab();
    expect(document.activeElement).toBe(summary);
    await user.click(summary);
    expect(summary.parentElement?.hasAttribute("open")).toBe(true);
    await user.click(summary);
    expect(summary.parentElement?.hasAttribute("open")).toBe(false);
  });

  it("distinguishes initial loading, empty selection, unavailable data, and retained data during refreshes", () => {
    const { rerender } = render(
      <ConsumptionPanel {...defaults} items={[]} loading />,
    );
    expect(screen.getByRole("status").textContent).toBe("Loading consumption…");
    expect(screen.queryByText("No consumption recorded in this selection yet."))
      .toBeNull();
    rerender(
      <ConsumptionPanel
        {...defaults}
        items={[{ ...anime, status: "planned", progress: 0 }]}
      />,
    );
    expect(screen.getByText("No consumption recorded in this selection yet."))
      .not
      .toBeNull();
    expect(screen.queryByText("Episodes")).toBeNull();
    rerender(<ConsumptionPanel {...defaults} items={[]} error="Unavailable" />);
    expect(screen.getByText(/Consumption is unavailable/u)).not.toBeNull();
    rerender(<ConsumptionPanel {...defaults} items={[anime]} loading />);
    expect(screen.getByRole("status").textContent).toBe(
      "Refreshing consumption…",
    );
    expect(screen.getByRole("region", { name: "Anime consumption" })).not
      .toBeNull();
    rerender(
      <ConsumptionPanel {...defaults} items={[anime]} error="Refresh failed" />,
    );
    expect(screen.getByRole("region", { name: "Anime consumption" })).not
      .toBeNull();
    expect(screen.queryByText(/Consumption is unavailable/u)).toBeNull();
  });
});
