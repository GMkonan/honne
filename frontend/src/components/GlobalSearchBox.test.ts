import { describe, expect, it } from "vitest";
import { catalogCoverStyle } from "./GlobalSearchBox.tsx";

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
