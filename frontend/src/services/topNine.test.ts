import { describe, expect, it, vi } from "vitest";
import { createFetchRouter } from "../test/fetch-router.ts";
import { loadTopNine, saveTopNine } from "./topNine.ts";

describe("3×3 API", () => {
  it("rejects malformed selections rather than exposing invalid server data", async () => {
    const router = createFetchRouter();
    vi.stubGlobal("fetch", router.fetch);
    for (
      const value of [
        {},
        { mediaIds: null },
        { mediaIds: [0] },
        { mediaIds: [1, 1] },
        { mediaIds: [1.5] },
        { mediaIds: ["1"] },
      ]
    ) {
      router.json("GET", "/api/top-nine", value);
      await expect(loadTopNine(new AbortController().signal)).rejects.toThrow(
        "response was invalid",
      );
    }
    router.json(
      "GET",
      "/api/top-nine",
      () => new Response("Unavailable", { status: 503 }),
    );
    await expect(loadTopNine(new AbortController().signal)).rejects.toThrow(
      "Please try again",
    );
  });

  it("saves an explicitly empty top nine without confusing it with a read", async () => {
    const router = createFetchRouter();
    router.json("PUT", "/api/top-nine", async (request: Request) => {
      expect(await request.json()).toEqual({ mediaIds: [] });
      return Response.json({ mediaIds: [] });
    });
    vi.stubGlobal("fetch", router.fetch);
    await expect(saveTopNine([], new AbortController().signal)).resolves
      .toEqual([]);
  });
});
