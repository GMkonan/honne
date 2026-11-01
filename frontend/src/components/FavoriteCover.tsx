import { useState } from "react";

interface FavoriteCoverProps {
  title: string;
  coverUrl: string;
}

export function FavoriteCover({ title, coverUrl }: FavoriteCoverProps) {
  const [failedCover, setFailedCover] = useState("");
  let cover = "";
  try {
    const url = new URL(coverUrl);
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username && !url.password
    ) cover = url.href;
  } catch {
    // Missing or invalid cover URLs keep the title fallback.
  }
  return (
    <span className="favorite-cover" aria-hidden="true">
      {cover && cover !== failedCover
        ? (
          <img
            src={cover}
            alt=""
            width={150}
            height={200}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedCover(cover)}
          />
        )
        : <span>{Array.from(title.trim()).slice(0, 2).join("")}</span>}
    </span>
  );
}
