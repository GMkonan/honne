import { describe, expect, it } from "vitest";
import {
  catalogCoverStyle,
  matchingSearchOperators,
  parseSearchQuery,
} from "./GlobalSearchBox.tsx";

describe("search operators", () => {
  it("parses canonical and alias prefixes without changing normal titles", () => {
    expect(parseSearchQuery("anime:sangatsu", "all")).toEqual({
      query: "sangatsu",
      scope: "anime",
      operator: "anime",
    });
    expect(parseSearchQuery("movies:Arrival", "book")).toEqual({
      query: "Arrival",
      scope: "movie",
      operator: "movies",
    });
    expect(parseSearchQuery("ln: Monogatari", "all")).toEqual({
      query: "Monogatari",
      scope: "light_novel",
      operator: "ln",
    });
    expect(parseSearchQuery("Cowboy Bebop: The Movie", "series")).toEqual({
      query: "Cowboy Bebop: The Movie",
      scope: "series",
      operator: "",
    });
    expect(parseSearchQuery("unknown:title", "game")).toEqual({
      query: "unknown:title",
      scope: "game",
      operator: "",
    });
  });

  it("offers canonical operators for a partial prefix", () => {
    expect(matchingSearchOperators("ser").map((option) => option.operator))
      .toEqual(["series"]);
    expect(matchingSearchOperators("light-").map((option) => option.operator))
      .toEqual(["light-novel"]);
    expect(matchingSearchOperators("series:")).toEqual([]);
  });
});

describe("catalogCoverStyle", () => {
  it("accepts public HTTP images and rejects unsafe URLs", () => {
    expect(catalogCoverStyle("https://images.example/cover.jpg")).toEqual({
      backgroundImage: 'url("https://images.example/cover.jpg")',
    });
    expect(catalogCoverStyle("javascript:alert(1)")).toBeUndefined();
    expect(catalogCoverStyle("https://owner:secret@example.com/cover.jpg"))
      .toBeUndefined();
    expect(catalogCoverStyle("not a URL")).toBeUndefined();
  });
});
