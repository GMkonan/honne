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

  it("includes completed-only genre statistics before favorites without changing the Library summary", () => {
    render(<OverviewPage {...defaults} />);
    const stats = screen.getByRole("region", { name: "Genre stats" });
    const favorites = screen.getByRole("complementary", { name: "Favorites" });
    expect(
      stats.compareDocumentPosition(favorites) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    )
      .toBeTruthy();
    expect(within(stats).getByRole("tabpanel", { name: "Movies" })).not
      .toBeNull();
    expect(
      within(stats).getByText("Completed").parentElement?.querySelector("dd")
        ?.textContent,
    )
      .toBe("1");
    const summary = screen.getByRole("region", { name: "At a glance" });
    expect(
      within(summary).getByText("Total titles").parentElement?.querySelector(
        "dd",
      )?.textContent,
    )
      .toBe("3");
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
