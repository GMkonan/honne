import { type ReactNode, useState } from "react";

interface LibraryCoverProps {
  coverUrl: string;
  priority: boolean;
  fallback: ReactNode;
}

// Keep these slot widths aligned with the Library grid in styles.css.
const coverSizes = [
  "(max-width: 420px) calc(50vw - 18px)",
  "(max-width: 600px) calc(33.333vw - 16px)",
  "(max-width: 800px) calc(25vw - 17px)",
  "(max-width: 1050px) calc(25vw - 107px)",
  "(max-width: 1260px) calc(20vw - 88px)",
  "165px",
].join(", ");

function coverSources(rawURL: string) {
  try {
    const url = new URL(rawURL);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username || url.password
    ) return null;

    const original = url.href;
    if (
      url.hostname === "image.tmdb.org" &&
      /^\/t\/p\/(w\d+|original)\/[^/]+$/.test(url.pathname)
    ) {
      const path = url.pathname;
      const sizedURL = (width: number) => {
        url.pathname = path.replace(/\/t\/p\/[^/]+\//, `/t/p/w${width}/`);
        return url.href;
      };
      return {
        original,
        src: sizedURL(185),
        srcSet: [154, 185, 342, 500, 780].map((width) =>
          `${sizedURL(width)} ${width}w`
        ).join(", "),
        sizes: coverSizes,
      };
    }
    if (
      url.hostname === "covers.openlibrary.org" &&
      /^\/b\/(id|isbn|olid)\/[^/]+-[SML]\.jpg$/.test(url.pathname)
    ) {
      url.pathname = url.pathname.replace(/-[SML]\.jpg$/, "-M.jpg");
      const medium = url.href;
      url.pathname = url.pathname.replace(/-M\.jpg$/, "-L.jpg");
      return {
        original,
        src: medium,
        srcSet: `${medium} 1x, ${url.href} 2x`,
        sizes: undefined,
      };
    }
    return { original, src: original, srcSet: undefined, sizes: undefined };
  } catch {
    return null;
  }
}

export function LibraryCover(
  { coverUrl, priority, fallback }: LibraryCoverProps,
) {
  const [failure, setFailure] = useState<
    {
      url: string;
      attempt: "original" | "failed";
    } | null
  >(null);
  const sources = coverSources(coverUrl);
  const attempt = failure?.url === coverUrl ? failure.attempt : "sized";

  if (!sources || attempt === "failed") {
    return (
      <span className="library-cover fallback-cover" aria-hidden="true">
        {fallback}
      </span>
    );
  }

  return (
    <img
      className="library-cover"
      src={attempt === "original" ? sources.original : sources.src}
      srcSet={attempt === "original" ? undefined : sources.srcSet}
      sizes={attempt === "original" ? undefined : sources.sizes}
      alt=""
      width={200}
      height={285}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() =>
        setFailure({
          url: coverUrl,
          attempt: attempt === "sized" && sources.srcSet
            ? "original"
            : "failed",
        })}
    />
  );
}
