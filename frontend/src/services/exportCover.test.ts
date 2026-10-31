import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadExportCover } from "./exportCover.ts";

const NativeURL = URL;
const coverURL = "https://image.tmdb.org/t/p/w500/cover.png";
const decode = vi.fn<() => Promise<void>>();
let imageWidth = 300;
let imageHeight = 450;

function imageResponse() {
  return new Response(new Uint8Array([1, 2, 3]), {
    headers: { "Content-Type": "image/png" },
  });
}

beforeEach(() => {
  imageWidth = 300;
  imageHeight = 450;
  decode.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    "Image",
    function () {
      const image = document.createElement("img");
      Object.defineProperties(image, {
        naturalWidth: { get: () => imageWidth },
        naturalHeight: { get: () => imageHeight },
      });
      image.decode = decode;
      return image;
    },
  );
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = vi.fn(() => "blob:cover");
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => vi.restoreAllMocks());

describe("bounded image-export covers", () => {
  it("ignores unsafe URLs without making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (
      const url of [
        "",
        "/relative.png",
        "javascript:alert(1)",
        "data:image/png,x",
        "https://owner:secret@example.com/cover.png",
      ]
    ) {
      expect(await loadExportCover(url)).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads through the same-origin proxy and releases its object URL", async () => {
    const fetch = vi.fn(() => Promise.resolve(imageResponse()));
    vi.stubGlobal("fetch", fetch);
    expect(await loadExportCover(coverURL)).toBeInstanceOf(HTMLImageElement);
    expect(fetch).toHaveBeenCalledWith(
      `/api/images/cover?url=${encodeURIComponent(coverURL)}`,
      expect.objectContaining({
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cover");
  });

  it("falls back to a public URL without credentials or referrer", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(
      new TypeError("proxy unavailable"),
    )
      .mockResolvedValueOnce(imageResponse());
    vi.stubGlobal("fetch", fetch);
    expect(await loadExportCover(coverURL)).not.toBeNull();
    expect(fetch).toHaveBeenLastCalledWith(
      coverURL,
      expect.objectContaining({
        credentials: "omit",
        mode: "cors",
        referrerPolicy: "no-referrer",
      }),
    );
  });

  it("rejects SVG and oversized responses before decoding", async () => {
    const headerCases: HeadersInit[] = [
      { "Content-Type": "image/svg+xml" },
      { "Content-Type": "image/png", "Content-Length": "6000000" },
    ];
    for (const headers of headerCases) {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(new Response("untrusted", { headers }))),
      );
      expect(await loadExportCover(coverURL)).toBeNull();
    }
    expect(decode).not.toHaveBeenCalled();
  });

  it("bounds an undeclared streaming response and cancels the body", async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
              },
              cancel,
            }),
            { headers: { "Content-Type": "image/png" } },
          ),
        )
      ),
    );
    expect(await loadExportCover(coverURL)).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(decode).not.toHaveBeenCalled();
  });

  it("uses fallbacks for invalid dimensions and failed image decoding", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(imageResponse())));
    imageWidth = 10_001;
    expect(await loadExportCover(coverURL)).toBeNull();
    imageWidth = 300;
    decode.mockRejectedValue(new Error("bad image"));
    expect(await loadExportCover(coverURL)).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });

  it("times out both sources instead of hanging an export", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("timeout", "AbortError")),
          { once: true },
        );
      })
    );
    vi.stubGlobal("fetch", fetch);
    const result = loadExportCover(coverURL);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(await result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels pending decoding without fallback and releases the image URL", async () => {
    let started: () => void = () => {};
    const decoding = new Promise<void>((resolve) => started = resolve);
    decode.mockImplementation(() => {
      started();
      return new Promise(() => {});
    });
    const fetch = vi.fn(() => Promise.resolve(imageResponse()));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const result = loadExportCover(coverURL, controller.signal);
    await decoding;
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cover");
  });
});
