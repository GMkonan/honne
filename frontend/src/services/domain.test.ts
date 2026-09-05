import { expect, it, vi } from "vitest";
import {
  disconnectAniList,
  importAniListLibrary,
  previewAniListImport,
  retryAniList,
} from "./anilist.ts";
import { searchCatalog } from "./discovery.ts";
import { createFetchRouter } from "../test/fetch-router.ts";

it("keeps AniList and catalog service contracts", async () => {
  const router = createFetchRouter()
    .empty("DELETE", "/api/integrations/anilist?discardPending=true")
    .json("POST", "/api/integrations/anilist/retry", { queued: 2 })
    .json("GET", "/api/import/anilist?username=synthetic%20user", {
      username: "synthetic user",
      entries: [],
    })
    .json("POST", "/api/import/anilist", {
      imported: 0,
      skipped: 0,
      items: [],
    })
    .json("GET", "/api/discovery/search?type=anime&q=space&page=2", {
      results: [],
      page: 2,
      hasMore: false,
    });
  vi.stubGlobal("fetch", router.fetch);

  await disconnectAniList(true);
  await expect(retryAniList()).resolves.toEqual({ queued: 2 });
  await expect(previewAniListImport("synthetic user")).resolves.toMatchObject({
    username: "synthetic user",
  });
  await importAniListLibrary({
    username: "synthetic user",
    types: ["anime"],
    statuses: ["planned"],
  });
  await expect(searchCatalog("anime", "space", 2)).resolves.toMatchObject({
    page: 2,
  });

  const importRequest = router.requests.find((request) =>
    request.method === "POST" &&
    new URL(request.url).pathname === "/api/import/anilist"
  );
  expect(await importRequest?.json()).toEqual({
    username: "synthetic user",
    types: ["anime"],
    statuses: ["planned"],
  });
});
