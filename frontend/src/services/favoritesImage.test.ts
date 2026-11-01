import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import * as exportCover from "./exportCover.ts";
import {
  createFavoritesImage,
  favoritesImageFilename,
} from "./favoritesImage.ts";

const originalContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  "getContext",
);

function mockCanvas() {
  const context = {
    textBaseline: "",
    fillStyle: "",
    font: "",
    fillRect: vi.fn(),
    fillText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    measureText: (text: string) => ({ width: Array.from(text).length * 12 }),
  };
  let canvas: HTMLCanvasElement | undefined;
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: function (this: HTMLCanvasElement) {
      canvas = this;
      return context;
    },
  });
  const blob = new Blob(["synthetic PNG"], { type: "image/png" });
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback) => callback(blob));
  return { context, blob, encode, canvas: () => canvas };
}

beforeEach(() =>
  vi.spyOn(exportCover, "loadExportCover").mockResolvedValue(null)
);
afterEach(() => {
  vi.restoreAllMocks();
  if (originalContext) {
    Object.defineProperty(
      HTMLCanvasElement.prototype,
      "getContext",
      originalContext,
    );
  }
});

describe("favorites PNG", () => {
  it("uses a stable filename and rejects empty or overfull grids", async () => {
    expect(favoritesImageFilename("anime")).toBe(
      "honne-favorites-anime-3x3.png",
    );
    expect(favoritesImageFilename("light_novel")).toBe(
      "honne-favorites-light_novel-3x3.png",
    );
    for (const count of [0, 10]) {
      await expect(
        createFavoritesImage(
          Array.from(
            { length: count },
            () => ({ title: "Title", coverUrl: "" }),
          ),
          new AbortController().signal,
        ),
      )
        .rejects.toThrow("one and nine");
    }
    expect(exportCover.loadExportCover).not.toHaveBeenCalled();
  });

  it("renders nine fixed slots, keeps order, and uses title fallbacks", async () => {
    const { context, blob, encode, canvas } = mockCanvas();
    const image = document.createElement("img");
    Object.defineProperties(image, {
      naturalWidth: { value: 300 },
      naturalHeight: { value: 600 },
    });
    vi.mocked(exportCover.loadExportCover).mockResolvedValueOnce(image);
    const items = [
      {
        title: "First favorite",
        coverUrl: "https://example.com/one.png",
        notes: "PRIVATE NOTES",
        rating: 10,
      },
      {
        title: "Second favorite",
        coverUrl: "",
        notes: "PRIVATE NOTES",
        rating: 8,
      },
    ];
    const result = await createFavoritesImage(
      items,
      new AbortController().signal,
      "Anime",
    );
    expect(result).toEqual({ blob, missingCovers: 1 });
    expect(canvas()?.width).toBe(1080);
    expect(canvas()?.height).toBe(1200);
    expect(encode).toHaveBeenCalledWith(expect.any(Function), "image/png");
    expect(context.rect).toHaveBeenCalledTimes(9);
    expect(context.drawImage).toHaveBeenCalledWith(
      image,
      expect.closeTo(54),
      expect.closeTo(-8),
      expect.closeTo(316),
      expect.closeTo(632),
    );
    expect(context.fillText.mock.calls.map(([text]) => text)).toEqual([
      "HANDPICKED",
      "Anime favorites",
      "First favorite",
      "01",
      "Second favorite",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "HONNE · 3×3",
      "2 OF 9",
    ]);
  });

  it("bounds long unbroken titles and preserves the order of a full grid", async () => {
    const { context } = mockCanvas();
    const items = Array.from(
      { length: 9 },
      (_, index) => ({
        title: `${index}あ`.repeat(100),
        coverUrl: `https://example.com/${index}.png`,
      }),
    );
    const result = await createFavoritesImage(
      items,
      new AbortController().signal,
    );
    expect(result.missingCovers).toBe(9);
    expect(
      vi.mocked(exportCover.loadExportCover).mock.calls.map(([url]) => url),
    ).toEqual(items.map((item) => item.coverUrl));
    const text = context.fillText.mock.calls.map(([value]) => String(value));
    expect(text.filter((value) => value.endsWith("…"))).toHaveLength(9);
    expect(text.every((value) => Array.from(value).length * 12 <= 280)).toBe(
      true,
    );
  });

  it("reports unavailable canvas and failed PNG encoding", async () => {
    const { encode } = mockCanvas();
    const items = [{ title: "Favorite", coverUrl: "" }];
    encode.mockImplementation((callback) => callback(null));
    await expect(createFavoritesImage(items, new AbortController().signal))
      .rejects.toThrow("could not be created");
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: () => null,
    });
    await expect(createFavoritesImage(items, new AbortController().signal))
      .rejects.toThrow("unavailable in this browser");
  });

  it("does not return a stale PNG when canceled during encoding", async () => {
    const { encode, blob } = mockCanvas();
    let finish: BlobCallback = () => {};
    encode.mockImplementation((callback) => {
      finish = callback;
    });
    const controller = new AbortController();
    const result = createFavoritesImage(
      [{ title: "Favorite", coverUrl: "" }],
      controller.signal,
    );
    await waitFor(() => expect(encode).toHaveBeenCalled());
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    finish(blob);
    await rejection;
  });
});
