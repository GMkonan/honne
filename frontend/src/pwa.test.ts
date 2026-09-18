import { describe, expect, it } from "vitest";
import documentSource from "../index.html?raw";
import manifestSource from "../public/manifest.webmanifest?raw";

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
};

type WebManifest = {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
};

const manifest = JSON.parse(manifestSource) as WebManifest;

describe("installable app metadata", () => {
  it("links the manifest and iOS metadata from the document", () => {
    expect(documentSource).toContain(
      'content="width=device-width, initial-scale=1.0, viewport-fit=cover"',
    );
    expect(documentSource).toContain(
      'rel="manifest" href="/manifest.webmanifest"',
    );
    expect(documentSource).toContain(
      'name="apple-mobile-web-app-capable" content="yes"',
    );
    expect(documentSource).toContain(
      'rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"',
    );
  });

  it("provides a same-origin standalone manifest with install icons", () => {
    expect(manifest).toMatchObject({
      id: "/",
      name: "Honne",
      short_name: "Honne",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#11111b",
      theme_color: "#1e1e2e",
    });

    expect(manifest.icons).toEqual([
      {
        src: "/pwa-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
  });
});
