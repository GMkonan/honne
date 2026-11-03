import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManageMediaModal } from "./ManageMediaModal.tsx";
import type { DetailLibraryMedia } from "./MediaDetailPage.tsx";
import { cowboyBebop } from "../test/fixtures.ts";

const item: DetailLibraryMedia = {
  ...cowboyBebop,
  type: "series",
  status: "dropped",
  total: 60,
  format: "TV",
  genres: [],
  credits: [],
  releaseStatus: "",
  startDate: "",
  endDate: "",
  durationMinutes: 0,
  catalogTotal: 60,
  communityRating: 0,
  playtimeMinutes: 0,
  playedOnPlatforms: [],
  catalogPlatforms: [],
};

const seasons = [12, 13, 16].map((episodeCount, index) => ({
  providerId: String(index + 1),
  seasonNumber: index + 1,
  title: `Season ${index + 1}`,
  episodeCount,
  completed: true,
}));

describe("season tracking in library management", () => {
  it("saves the season sum, preserves status, and permits manual overrides", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ManageMediaModal
        item={item}
        seasons={seasons}
        onSave={onSave}
        onClose={vi.fn()}
        onEditDetails={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const selector = screen.getByRole("combobox", {
      name: /Completed seasons/u,
    });
    await user.selectOptions(selector, "3");
    expect((selector as HTMLSelectElement).value).toBe("3");
    const progress = screen.getByRole("spinbutton", {
      name: /Episodes watched/u,
    });
    expect((progress as HTMLInputElement).value).toBe("41");
    expect(
      (screen.getByRole("combobox", { name: "Status" }) as HTMLSelectElement)
        .value,
    )
      .toBe("dropped");
    await user.clear(progress);
    await user.type(progress, "42");
    expect((selector as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      progress: 42,
      status: "dropped",
      total: 60,
    }));
  });

  it("hides the shortcut without usable season data", () => {
    render(
      <ManageMediaModal
        item={item}
        seasons={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onEditDetails={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      within(screen.getByRole("dialog")).queryByRole("combobox", {
        name: /Completed seasons/u,
      }),
    ).toBeNull();
  });
});
