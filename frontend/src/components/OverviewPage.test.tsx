import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "../activityModel.ts";
import { mediaItems } from "../test/fixtures.ts";
import { OverviewPage } from "./OverviewPage.tsx";

const defaults = {
  items: mediaItems,
  activities: [] as ActivityEvent[],
  loading: false,
  activityLoading: false,
  error: "",
  favorites: <aside aria-label="Favorites">Favorite covers</aside>,
  onOpen: vi.fn(),
};

describe("Overview", () => {
  it("summarizes the Library, excludes unrated titles from the mean, and keeps list navigation distinct", () => {
    render(
      <OverviewPage
        {...defaults}
        items={mediaItems.map((item, index) => ({
          ...item,
          rating: index === 1 ? 0 : item.rating,
        }))}
      />,
    );
    const summary = screen.getByRole("region", { name: "At a glance" });
    const metric = (label: string) =>
      within(summary).getByText(label).parentElement?.querySelector("dd")
        ?.textContent;
    expect(metric("Total titles")).toBe("3");
    expect(metric("Completed")).toBe("1");
    expect(metric("In progress")).toBe("1");
    expect(metric("Mean score")).toBe("9.5");
    const nav = screen.getByRole("navigation", { name: "Library sections" });
    expect(
      within(nav).getByRole("link", { name: "Overview" }).getAttribute(
        "aria-current",
      ),
    ).toBe("page");
    expect(
      within(nav).getByRole("link", { name: "Library" }).getAttribute("href"),
    ).toBe("#library/list");
    expect(within(nav).queryByRole("link", { name: "Collection" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Favorites" })).not
      .toBeNull();
    expect(screen.getByText("No activity yet")).not.toBeNull();
  });

  it("shows eight newest events, opens current titles, and preserves deleted-title history", async () => {
    const activities: ActivityEvent[] = Array.from(
      { length: 10 },
      (_, index) => ({
        id: index + 1,
        mediaId: 1,
        title: `Event ${index + 1}`,
        mediaType: "anime",
        action: index === 8 ? "deleted" : "updated",
        changes: { fromProgress: index, toProgress: index + 1 },
        occurredAt: `2026-01-${String(index + 1).padStart(2, "0")}T12:00:00Z`,
      }),
    );
    const open = vi.fn();
    const user = userEvent.setup();
    render(
      <OverviewPage {...defaults} activities={activities} onOpen={open} />,
    );
    const feed = screen.getByRole("region", { name: "Recent activity" });
    const buttons = within(feed).getAllByRole("button");
    expect(buttons).toHaveLength(8);
    expect(buttons[0].textContent).toContain("Event 10");
    expect(buttons[7].textContent).toContain("Event 3");
    expect(buttons[1].hasAttribute("disabled")).toBe(true);
    await user.click(buttons[0]);
    expect(open).toHaveBeenCalledWith(1);
    expect(within(feed).queryByText("Event 2")).toBeNull();
    expect(
      within(feed).getByRole("link", { name: "View all" }).getAttribute("href"),
    ).toBe("#activity");
  });

  it("places favorites before the separate cards and keeps consumption focused on units", () => {
    render(<OverviewPage {...defaults} />);
    const stats = screen.getByRole("region", { name: "Genre stats" });
    const favorites = screen.getByRole("complementary", { name: "Favorites" });
    expect(
      favorites.compareDocumentPosition(stats) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    )
      .toBeTruthy();
    expect(within(stats).queryByText("Estimated watch time")).toBeNull();
    const consumption = screen.getByRole("region", {
      name: "Movies consumption",
    });
    expect(
      within(consumption).getByText("Viewings").parentElement?.querySelector(
        "dd",
      )
        ?.textContent,
    )
      .toBe("1 viewing");
    const summary = screen.getByRole("region", { name: "At a glance" });
    expect(
      within(summary).getByText("Total titles").parentElement?.querySelector(
        "dd",
      )?.textContent,
    )
      .toBe("3");
  });

  it("filters all statistics together without filtering favorites or activity, and resets to All media", async () => {
    const user = userEvent.setup();
    const items = [
      {
        ...mediaItems[0],
        status: "completed",
        progress: 12,
        rating: 8,
        genres: ["Comedy"],
        durationMinutes: 24,
      },
      { ...mediaItems[0], id: 4, rating: 6, genres: ["Action"] },
      {
        ...mediaItems[2],
        type: "series",
        progress: 10,
        rating: 9,
        genres: ["Drama"],
        durationMinutes: 45,
      },
      {
        ...mediaItems[2],
        id: 5,
        type: "game",
        rating: 7,
        genres: ["Adventure"],
        playtimeMinutes: 120,
      },
    ];
    const activities: ActivityEvent[] = [{
      id: 1,
      mediaId: 1,
      title: "Anime event",
      mediaType: "anime",
      action: "updated",
      changes: {},
      occurredAt: "2026-01-01T00:00:00Z",
    }, {
      id: 2,
      mediaId: 5,
      title: "Game event",
      mediaType: "game",
      action: "updated",
      changes: {},
      occurredAt: "2026-01-02T00:00:00Z",
    }];
    render(
      <OverviewPage {...defaults} items={items} activities={activities} />,
    );
    const filters = screen.getByRole("group", {
      name: "Statistics media type",
    });
    const summary = screen.getByRole("region", { name: "At a glance" });
    const metric = (label: string) =>
      within(summary).getByText(label).parentElement?.querySelector("dd")
        ?.textContent;
    expect(metric("Total titles")).toBe("4");
    expect(metric("Mean score")).toBe("7.5");
    const animeFilter = within(filters).getByRole("button", { name: "Anime" });
    animeFilter.focus();
    await user.keyboard("{Enter}");
    expect(animeFilter.getAttribute("aria-pressed")).toBe("true");
    expect(metric("Total titles")).toBe("2");
    expect(metric("Completed")).toBe("1");
    expect(metric("In progress")).toBe("1");
    expect(metric("Mean score")).toBe("7.0");
    expect(screen.getByRole("list", { name: "Anime genres" }).textContent)
      .toContain("100%Comedy");
    expect(screen.getByRole("list", { name: "Anime genres" }).textContent).not
      .toContain("Action");
    expect(
      screen.getByRole("region", { name: "Anime consumption" }).textContent,
    ).toContain("Episodes20");
    await user.click(within(filters).getByRole("button", { name: "Series" }));
    expect(metric("Mean score")).toBe("9.0");
    expect(screen.getByRole("list", { name: "Series genres" }).textContent)
      .toContain("100%Drama");
    expect(
      screen.getByRole("region", { name: "Series consumption" }).textContent,
    ).toContain("7h 30m");
    await user.click(within(filters).getByRole("button", { name: "Games" }));
    expect(metric("Total titles")).toBe("1");
    expect(metric("Mean score")).toBe("7.0");
    expect(screen.getByRole("list", { name: "Games genres" }).textContent)
      .toContain("100%Adventure");
    expect(
      screen.getByRole("region", { name: "Games consumption" }).textContent,
    ).toContain("Playtime2h");
    expect(screen.queryByRole("region", { name: "Anime consumption" }))
      .toBeNull();
    await user.click(within(filters).getByRole("button", { name: "Books" }));
    expect(metric("Total titles")).toBe("0");
    expect(metric("Mean score")).toBe("—");
    expect(within(summary).getByText("No titles in this selection yet.")).not
      .toBeNull();
    expect(screen.queryByRole("img", { name: /genre distribution/u }))
      .toBeNull();
    expect(screen.getByRole("complementary", { name: "Favorites" }).textContent)
      .toBe("Favorite covers");
    expect(
      within(screen.getByRole("region", { name: "Recent activity" }))
        .getAllByRole("button"),
    ).toHaveLength(2);
    const allFilter = within(filters).getByRole("button", {
      name: "All media",
    });
    allFilter.focus();
    await user.keyboard(" ");
    expect(metric("Total titles")).toBe("4");
    expect(screen.getByRole("region", { name: "Anime consumption" })).not
      .toBeNull();
    expect(screen.getByRole("region", { name: "Games consumption" })).not
      .toBeNull();
  });

  it("includes ongoing manga consumption through the shared filter while genres remain completed-only", async () => {
    const user = userEvent.setup();
    render(
      <OverviewPage
        {...defaults}
        items={[
          mediaItems[0],
          {
            ...mediaItems[0],
            id: 4,
            type: "manga",
            progress: 1000,
            total: 1500,
            genres: ["Adventure"],
          },
        ]}
      />,
    );
    const filters = screen.getByRole("group", {
      name: "Statistics media type",
    });
    await user.click(within(filters).getByRole("button", { name: "Manga" }));
    const consumption = screen.getByRole("region", {
      name: "Manga consumption",
    });
    expect(
      within(consumption).getByText("Chapters").parentElement
        ?.querySelector("dd")?.textContent,
    ).toBe("1,000 chapters");
    const summary = screen.getByRole("region", { name: "At a glance" });
    expect(
      within(summary).getByText("In progress").parentElement?.querySelector(
        "dd",
      )?.textContent,
    ).toBe("1");
    const genres = screen.getByRole("region", { name: "Genre stats" });
    expect(
      within(genres).getByText("No completed titles in this selection yet."),
    ).not.toBeNull();
    expect(within(genres).queryByRole("img")).toBeNull();
    expect(screen.queryByRole("region", { name: "Anime consumption" }))
      .toBeNull();
  });

  it("distinguishes loading, empty data, and unavailable data instead of inventing zero counts", () => {
    const { rerender } = render(
      <OverviewPage {...defaults} items={[]} loading activityLoading />,
    );
    expect(screen.getByText("Loading your Library…")).not.toBeNull();
    expect(screen.getByText("Loading recent activity…")).not.toBeNull();
    expect(screen.queryByText("No activity yet")).toBeNull();
    rerender(<OverviewPage {...defaults} items={[]} />);
    expect(screen.getByText(/Your Library is empty/u)).not.toBeNull();
    expect(screen.getByText("No activity yet")).not.toBeNull();
    rerender(
      <OverviewPage
        {...defaults}
        items={[]}
        activityError="Activity unavailable"
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe("Activity unavailable");
    expect(screen.queryByText("No activity yet")).toBeNull();
    expect(screen.getByText("Recent activity could not be loaded.")).not
      .toBeNull();
    expect(screen.getByRole("complementary", { name: "Favorites" })).not
      .toBeNull();
  });

  it("keeps confirmed metrics and activity readable while refreshing", () => {
    const activity: ActivityEvent = {
      id: 1,
      mediaId: 1,
      title: "Cowboy Bebop",
      mediaType: "anime",
      action: "updated",
      changes: {},
      occurredAt: "2026-01-01T00:00:00Z",
    };
    render(
      <OverviewPage
        {...defaults}
        activities={[activity]}
        loading
        activityLoading
      />,
    );
    const summary = screen.getByRole("region", { name: "At a glance" });
    expect(
      within(summary).getByText("Total titles").parentElement?.querySelector(
        "dd",
      )
        ?.textContent,
    ).toBe("3");
    expect(within(summary).getByRole("status")).not.toBeNull();
    const feed = screen.getByRole("region", { name: "Recent activity" });
    expect(within(feed).getByRole("status")).not.toBeNull();
    expect(within(feed).getByRole("button", { name: /Cowboy Bebop/u }))
      .not.toBeNull();
  });

  it("keeps valid summary and activity data visible when an independent refresh fails", () => {
    const activity: ActivityEvent = {
      id: 1,
      mediaId: 1,
      title: "Cowboy Bebop",
      mediaType: "anime",
      action: "updated",
      changes: {},
      occurredAt: "2026-01-01T00:00:00Z",
    };
    render(
      <OverviewPage
        {...defaults}
        activities={[activity]}
        error="Library refresh failed"
        activityError="Activity refresh failed"
      />,
    );
    const summary = screen.getByRole("region", { name: "At a glance" });
    expect(
      within(summary).getByText("Total titles").parentElement?.querySelector(
        "dd",
      )?.textContent,
    ).toBe("3");
    expect(screen.getByRole("button", { name: /Cowboy Bebop/u })).not
      .toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });
});
