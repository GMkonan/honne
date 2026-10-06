import {
  monthlyLogLabel,
  type MonthlyLogMediaType,
  type MonthlyLogSummary,
} from "../recapModel.ts";

interface MonthlyLogImageOptions {
  summary: MonthlyLogSummary;
  profileName: string;
}

const width = 1080;
const height = 1350;
const maxCoverBytes = 5 * 1024 * 1024;
const palette = {
  crust: "#11111b",
  mantle: "#181825",
  surface: "#313244",
  overlay: "#6c7086",
  muted: "#a6adc8",
  text: "#cdd6f4",
  blue: "#89b4fa",
  sapphire: "#74c7ec",
  mauve: "#cba6f7",
};
const typeLabels: Record<string, string> = {
  anime: "ANIME",
  series: "SERIES",
  movie: "MOVIE",
  book: "BOOK",
  manga: "MANGA",
  light_novel: "LIGHT NOVEL",
  game: "GAME",
};

export function monthlyLogFilename(
  startsAt: Date,
  mediaType: MonthlyLogMediaType = "all",
): string {
  const year = startsAt.getFullYear();
  const month = String(startsAt.getMonth() + 1).padStart(2, "0");
  const scope = mediaType === "all" ? "" : `-${mediaType.replace("_", "-")}`;
  return `honne-monthly-log-${year}-${month}${scope}.png`;
}

async function loadCover(url: string): Promise<HTMLImageElement | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { credentials: "omit", mode: "cors" });
    const declaredSize = Number(response.headers.get("Content-Length") || 0);
    if (!response.ok || declaredSize > maxCoverBytes) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/") || blob.size > maxCoverBytes) {
      return null;
    }
    const objectURL = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = objectURL;
      await image.decode();
      if (
        image.naturalWidth < 1 || image.naturalHeight < 1 ||
        image.naturalWidth > 10_000 || image.naturalHeight > 10_000
      ) return null;
      return image;
    } finally {
      URL.revokeObjectURL(objectURL);
    }
  } catch {
    return null;
  }
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  x: number,
  y: number,
  index: number,
) {
  const coverWidth = 76;
  const coverHeight = 114;
  context.save();
  context.beginPath();
  context.rect(x, y, coverWidth, coverHeight);
  context.clip();
  if (image) {
    const scale = Math.max(
      coverWidth / image.naturalWidth,
      coverHeight / image.naturalHeight,
    );
    const drawnWidth = image.naturalWidth * scale;
    const drawnHeight = image.naturalHeight * scale;
    context.drawImage(
      image,
      x - (drawnWidth - coverWidth) / 2,
      y - (drawnHeight - coverHeight) / 2,
      drawnWidth,
      drawnHeight,
    );
  } else {
    context.fillStyle = index % 2 === 0 ? palette.mauve : palette.blue;
    context.fillRect(x, y, coverWidth, coverHeight);
    context.fillStyle = palette.crust;
    context.font = "700 22px 'IBM Plex Mono', monospace";
    context.fillText(String(index + 1).padStart(2, "0"), x + 12, y + 12);
  }
  context.restore();
}

function drawWrappedTitle(
  context: CanvasRenderingContext2D,
  title: string,
  x: number,
  y: number,
  maxWidth: number,
) {
  const words = title.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1) || "";
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      if (lines.length === 2) break;
      lines.push(word);
    } else if (lines.length === 0) lines.push(candidate);
    else lines[lines.length - 1] = candidate;
  }
  const visible = lines.slice(0, 2);
  if (lines.length > 2 && visible.length === 2) {
    visible[1] = `${visible[1].replace(/[.…]+$/u, "")}…`;
  }
  visible.forEach((line, index) => context.fillText(line, x, y + index * 25));
}

export async function createMonthlyLogImage(
  options: MonthlyLogImageOptions,
): Promise<Blob> {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image generation is unavailable in this browser.");
  }

  const covers = await Promise.all(
    options.summary.entries.map((entry) => loadCover(entry.media.coverUrl)),
  );
  context.textBaseline = "top";
  context.fillStyle = palette.crust;
  context.fillRect(0, 0, width, height);
  context.fillStyle = palette.blue;
  context.fillRect(0, 0, 14, height);
  context.fillRect(76, 70, 928, 2);

  context.fillStyle = palette.sapphire;
  context.font = "500 17px 'IBM Plex Mono', monospace";
  context.fillText("HONNE", 76, 92);
  context.fillStyle = palette.text;
  context.font = "700 34px 'Zen Kaku Gothic New', sans-serif";
  context.fillText(options.profileName || "My Library", 76, 119, 730);
  context.fillStyle = palette.blue;
  context.fillRect(894, 91, 110, 68);
  context.fillStyle = palette.crust;
  context.font = "700 31px 'Zen Kaku Gothic New', sans-serif";
  context.fillText("本音", 921, 107);

  const scopeLabel = options.summary.mediaType === "all"
    ? "ALL MEDIA"
    : typeLabels[options.summary.mediaType];
  context.fillStyle = palette.muted;
  context.font = "500 24px 'IBM Plex Mono', monospace";
  context.fillText(
    monthlyLogLabel(options.summary.startsAt).toUpperCase(),
    76,
    198,
  );

  if (options.summary.entries.length === 0) {
    context.strokeStyle = palette.surface;
    context.setLineDash([10, 8]);
    context.strokeRect(76, 255, 928, 963);
    context.setLineDash([]);
    context.fillStyle = palette.text;
    context.font = "700 34px 'Zen Kaku Gothic New', sans-serif";
    context.fillText("No completed or revisited titles", 292, 700);
  } else {
    options.summary.entries.forEach((entry, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = 76 + column * 316;
      const y = 255 + row * 154;
      context.fillStyle = palette.mantle;
      context.fillRect(x, y, 296, 138);
      context.strokeStyle = palette.surface;
      context.strokeRect(x + .5, y + .5, 295, 137);
      context.fillStyle = index % 2 === 0 ? palette.blue : palette.mauve;
      context.fillRect(x, y, 3, 138);
      drawCover(context, covers[index], x + 12, y + 12, index);
      context.fillStyle = palette.sapphire;
      context.font = "500 13px 'IBM Plex Mono', monospace";
      context.fillText(
        typeLabels[entry.media.type] || entry.media.type.toUpperCase(),
        x + 100,
        y + 16,
      );
      context.fillStyle = palette.text;
      context.font = "700 20px 'Zen Kaku Gothic New', sans-serif";
      drawWrappedTitle(context, entry.media.title, x + 100, y + 43, 180);
      context.fillStyle = palette.muted;
      context.font = "500 13px 'IBM Plex Mono', monospace";
      const note = entry.repeats > 0
        ? `${entry.repeats} REVISIT${entry.repeats === 1 ? "" : "S"}`
        : entry.media.rating > 0
        ? `★ ${entry.media.rating}/10`
        : "FINISHED";
      context.fillText(note, x + 100, y + 109);
    });
  }

  context.fillStyle = palette.blue;
  context.fillRect(76, 1250, 928, 2);
  context.font = "500 17px 'IBM Plex Mono', monospace";
  const finishedLabel = `${options.summary.completed} FINISHED${
    options.summary.repeats > 0
      ? `  /  ${options.summary.repeats} REVISITED`
      : ""
  }`;
  context.fillStyle = palette.text;
  context.fillText(finishedLabel, 76, 1281);
  context.fillStyle = palette.sapphire;
  const scopeWidth = context.measureText(scopeLabel).width;
  context.fillText(scopeLabel, 1004 - scopeWidth, 1281);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The Monthly Log image could not be created."));
    }, "image/png");
  });
}
