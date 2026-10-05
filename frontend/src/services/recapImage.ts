import {
  type RecapFocus,
  type RecapPeriod,
  recapPeriodLabel,
  type RecapSummary,
} from "../recapModel.ts";

interface RecapImageOptions {
  summary: RecapSummary;
  period: RecapPeriod;
  focus: RecapFocus;
  profileName: string;
  now: Date;
}

const width = 1080;
const height = 1350;
const maxCoverBytes = 5 * 1024 * 1024;
const typeLabels: Record<string, string> = {
  anime: "ANIME",
  series: "SERIES",
  movie: "MOVIE",
  book: "BOOK",
  manga: "MANGA",
  light_novel: "LIGHT NOVEL",
  game: "GAME",
};

function periodNumber(period: RecapPeriod): string {
  return period === "week" ? "07" : period === "month" ? "30" : "365";
}

export function recapFilename(period: RecapPeriod, focus: RecapFocus): string {
  return `honne-${focus}-${periodNumber(period)}-days.png`;
}

function periodRange(startsAt: Date, now: Date): string {
  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${formatter.format(startsAt)} — ${formatter.format(now)}`;
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
  coverWidth: number,
  coverHeight: number,
  index: number,
) {
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
    context.fillStyle = index % 2 === 0 ? "#e65035" : "#1f55d5";
    context.fillRect(x, y, coverWidth, coverHeight);
    context.fillStyle = "#f2eee3";
    context.font = "700 30px 'IBM Plex Mono', monospace";
    context.fillText(String(index + 1).padStart(2, "0"), x + 18, y + 18);
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
  visible.forEach((line, lineIndex) =>
    context.fillText(line, x, y + lineIndex * 35)
  );
}

function drawStat(
  context: CanvasRenderingContext2D,
  value: number,
  label: string,
  x: number,
  dark = false,
) {
  context.fillStyle = dark ? "#171714" : "#f2eee3";
  context.fillRect(x, 358, 210, 58);
  context.fillStyle = dark ? "#f2eee3" : "#171714";
  context.font = "700 24px 'IBM Plex Mono', monospace";
  context.fillText(String(value), x + 15, 372);
  context.font = "500 18px 'IBM Plex Mono', monospace";
  context.fillText(label.toUpperCase(), x + 58, 376);
}

export async function createRecapImage(
  options: RecapImageOptions,
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
  context.fillStyle = "#f2eee3";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#171714";
  context.fillRect(76, 72, 928, 3);
  context.font = "500 20px 'IBM Plex Mono', monospace";
  context.fillText("HONNE / CULTURE LOG", 76, 94);
  context.font = "700 23px 'IBM Plex Mono', monospace";
  context.fillText(options.profileName || "My Library", 76, 124);
  context.fillStyle = "#1f55d5";
  context.fillRect(916, 92, 88, 58);
  context.fillStyle = "#f2eee3";
  context.font = "700 27px 'Zen Kaku Gothic New', sans-serif";
  context.fillText("本音", 934, 105);

  context.fillStyle = "#171714";
  context.font = "500 19px 'IBM Plex Mono', monospace";
  context.fillText(recapPeriodLabel(options.period).toUpperCase(), 76, 200);
  context.font = "700 72px 'Zen Kaku Gothic New', sans-serif";
  context.fillText(
    options.focus === "finished" ? "Stories I finished" : "New on my shelf",
    76,
    230,
  );
  context.font = "500 18px 'IBM Plex Mono', monospace";
  context.fillText(
    periodRange(options.summary.startsAt, options.now).toUpperCase(),
    76,
    322,
  );
  drawStat(context, options.summary.completed, "finished", 76, true);
  drawStat(context, options.summary.repeats, "revisited", 300);
  drawStat(context, options.summary.added, "added", 524);

  if (options.summary.entries.length === 0) {
    context.strokeStyle = "#8e897f";
    context.setLineDash([10, 8]);
    context.strokeRect(76, 468, 928, 720);
    context.setLineDash([]);
    context.fillStyle = "#171714";
    context.font = "700 34px 'Zen Kaku Gothic New', sans-serif";
    context.fillText("No entries for this edition", 304, 770);
  } else {
    options.summary.entries.forEach((entry, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const x = 76 + column * 478;
      const y = 468 + row * 238;
      context.fillStyle = "rgba(23, 23, 20, .22)";
      context.fillRect(x, y, 440, 1);
      drawCover(context, covers[index], x, y + 20, 126, 188, index);
      context.fillStyle = "#1f55d5";
      context.font = "500 17px 'IBM Plex Mono', monospace";
      context.fillText(
        typeLabels[entry.media.type] || entry.media.type.toUpperCase(),
        x + 150,
        y + 28,
      );
      context.fillStyle = "#171714";
      context.font = "700 29px 'Zen Kaku Gothic New', sans-serif";
      drawWrappedTitle(context, entry.media.title, x + 150, y + 60, 285);
      context.fillStyle = "#5d5a53";
      context.font = "500 17px 'IBM Plex Mono', monospace";
      const note = entry.media.rating > 0
        ? `★ ${entry.media.rating}/10`
        : entry.repeats > 0
        ? `${entry.repeats} REVISIT${entry.repeats === 1 ? "" : "S"}`
        : "IN THIS EDITION";
      context.fillText(note, x + 150, y + 158);
    });
  }

  context.fillStyle = "#171714";
  context.fillRect(76, 1265, 928, 3);
  context.font = "500 18px 'IBM Plex Mono', monospace";
  context.fillText("LOCAL BY DESIGN", 76, 1292);
  context.font = "700 20px 'IBM Plex Mono', monospace";
  context.fillText("HONNE", 505, 1290);
  context.font = "500 18px 'IBM Plex Mono', monospace";
  context.fillText(`NO. ${periodNumber(options.period)}`, 896, 1292);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The recap image could not be created."));
    }, "image/png");
  });
}
