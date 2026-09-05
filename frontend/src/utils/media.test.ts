import { describe, expect, it, vi } from "vitest";
import { createMedia } from "../services/library.ts";
import { cowboyBebop } from "../test/fixtures.ts";
import {
  mediaToInput,
  plannedLabel,
  previewCover,
  statusLabel,
} from "./media.ts";

describe("media utilities", () => {
  it("projects Media into an explicit MediaInput payload", async () => {
    const input = mediaToInput(cowboyBebop);
    expect(input).toEqual({
      title: "Cowboy Bebop",
      type: "anime",
      status: "in_progress",
      progress: 8,
      total: 26,
      rating: 9,
      notes: "Synthetic fixture",
      coverUrl: "",
      provider: "anilist",
      providerId: "1",
      providerUrl: "https://anilist.co/anime/1",
      originalTitle: "カウボーイビバップ",
      description: "Synthetic description",
      releaseYear: 1998,
    });
    expect("id" in input).toBe(false);
    expect("syncStatus" in input).toBe(false);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(cowboyBebop), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createMedia(input);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent).toEqual(input);
  });

  it("keeps contextual labels and safe cover previews", () => {
    expect(plannedLabel("book")).toBe("Plan to read");
    expect(plannedLabel("anime")).toBe("Plan to watch");
    expect(plannedLabel("all")).toBe("Plan to read/watch");
    expect(statusLabel("planned", "manga")).toBe("Plan to read");
    expect(previewCover([{ ...cowboyBebop, coverUrl: 'https://img/"cover"' }]))
      .toBe("https://img/cover");
  });
});
