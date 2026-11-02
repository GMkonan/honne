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
  it("shows completed-only progress, repeats, and estimated watch time without a genre chart", async () => {
    const user = userEvent.setup();
    render(
      <ConsumptionPanel
        {...defaults}
        items={[
          { ...anime, repeatCount: 1 },
          { ...anime, status: "in_progress", progress: 100 },
        ]}
      />,
    );
    const card = screen.getByRole("region", { name: "Consumption" });
    const group = within(card).getByRole("region", {
      name: "Anime consumption",
    });
    expect(metric(group, "Completed")).toBe("1");
    expect(metric(group, "Episodes recorded")).toBe("24");
    expect(metric(group, "Estimated watch time")).toBe("9h 36m");
    expect(within(card).queryByRole("img")).toBeNull();
    const method = within(card).getByText("How consumption is calculated");
    await user.click(method);
    expect(method.parentElement?.hasAttribute("open")).toBe(true);
    expect(within(card).getByText(/not multiplied by replays/u)).not.toBeNull();
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
        "Episodes recorded",
      ),
    ).toBe("12");
    expect(
      metric(
        screen.getByRole("region", { name: "Series consumption" }),
        "Estimated watch time",
      ),
    ).toBe("7h 30m");
    expect(
      metric(
        screen.getByRole("region", { name: "Movies consumption" }),
        "Viewings",
      ),
    ).toBe("2");
    expect(
      metric(
        screen.getByRole("region", { name: "Books consumption" }),
        "Pages recorded",
      ),
    ).toBe("412");
    expect(
      metric(
        screen.getByRole("region", { name: "Manga consumption" }),
        "Chapters recorded",
      ),
    ).toBe("30");
    expect(
      metric(
        screen.getByRole("region", { name: "Light novels consumption" }),
        "Chapters recorded",
      ),
    ).toBe("20");
    const game = screen.getByRole("region", { name: "Games consumption" });
    expect(metric(game, "Recorded playtime")).toBe("1h 30m");
    expect(within(game).queryByText("Estimated watch time")).toBeNull();
    rerender(<ConsumptionPanel {...defaults} items={items} type="game" />);
    expect(screen.getByRole("region", { name: "Games consumption" })).not
      .toBeNull();
    expect(screen.queryByRole("region", { name: "Anime consumption" }))
      .toBeNull();
    expect(screen.queryByText("Pages recorded")).toBeNull();
  });

  it("preserves consumption without genres and reports missing progress, runtime, and repeat totals", () => {
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
    expect(metric(group, "Completed")).toBe("1");
    expect(metric(group, "Episodes recorded")).toBe("Not tracked");
    expect(metric(group, "Estimated watch time")).toBe("Unavailable");
    expect(
      within(group).getByText("Progress is missing for 1 completed title."),
    ).not.toBeNull();
    expect(
      within(group).getByText(/Some completed repeats have no known length/u),
    ).not.toBeNull();
    expect(within(group).getByText(/Watch time is incomplete for 1 of 1/u)).not
      .toBeNull();
  });

  it("reports missing game playtime without inventing zero hours", () => {
    render(
      <ConsumptionPanel
        {...defaults}
        type="game"
        items={[{ ...anime, type: "game", playtimeMinutes: 0 }]}
      />,
    );
    const group = screen.getByRole("region", { name: "Games consumption" });
    expect(metric(group, "Recorded playtime")).toBe("Not tracked");
    expect(within(group).getByText("Playtime is missing for 1 completed game."))
      .not.toBeNull();
  });

  it("distinguishes initial loading, empty selection, unavailable data, and retained data during refreshes", () => {
    const { rerender } = render(
      <ConsumptionPanel {...defaults} items={[]} loading />,
    );
    expect(screen.getByRole("status").textContent).toBe("Loading consumption…");
    expect(screen.queryByText("No completed titles in this selection yet."))
      .toBeNull();
    rerender(
      <ConsumptionPanel
        {...defaults}
        items={[{ ...anime, status: "planned" }]}
      />,
    );
    expect(screen.getByText("No completed titles in this selection yet.")).not
      .toBeNull();
    expect(screen.queryByText("Episodes recorded")).toBeNull();
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
