import { loadExportCover } from "./exportCover.ts";

interface FavoriteImageItem {
  title: string;
  coverUrl: string;
}

export const favoritesImageFilename = "honne-favorites-3x3.png";

function drawTitle(
  context: CanvasRenderingContext2D,
  title: string,
  x: number,
  y: number,
) {
  const lines = [""];
  for (const character of title.slice(0, 200)) {
    const last = lines.length - 1;
    if (context.measureText(lines[last] + character).width > 280) {
      if (lines.length === 2) {
        while (
          lines[last] && context.measureText(lines[last] + "…").width > 280
        ) {
          lines[last] = lines[last].slice(0, -1);
        }
        lines[last] += "…";
        break;
      }
      lines.push(character.trimStart());
    } else lines[last] += character;
  }
  lines.forEach((line, index) =>
    context.fillText(line.trim(), x, y + index * 28)
  );
}

export async function createFavoritesImage(
  items: readonly FavoriteImageItem[],
  signal: AbortSignal,
): Promise<{ blob: Blob; missingCovers: number }> {
  signal.throwIfAborted();
  if (items.length < 1 || items.length > 9) {
    throw new Error("Choose between one and nine favorites before exporting.");
  }
  await document.fonts?.ready;
  signal.throwIfAborted();
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1200;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Image generation is unavailable in this browser.");
  }
  const covers = await Promise.all(
    items.map((item) => loadExportCover(item.coverUrl, signal)),
  );
  signal.throwIfAborted();
  context.textBaseline = "top";
  context.fillStyle = "#11111b";
  context.fillRect(0, 0, 1080, 1200);
  context.fillStyle = "#89b4fa";
  context.font = "500 18px 'IBM Plex Mono', monospace";
  context.fillText("HANDPICKED", 54, 36);
  context.fillStyle = "#cdd6f4";
  context.font = "700 44px 'Zen Kaku Gothic New', sans-serif";
  context.fillText("Favorites", 54, 65);

  for (let index = 0; index < 9; index++) {
    const x = 54 + (index % 3) * 328;
    const y = 150 + Math.floor(index / 3) * 328;
    const item = items[index];
    const cover = covers[index];
    context.save();
    context.beginPath();
    context.rect(x, y, 316, 316);
    context.clip();
    context.fillStyle = item ? "#313244" : "#181825";
    context.fillRect(x, y, 316, 316);
    if (cover) {
      const scale = Math.max(
        316 / cover.naturalWidth,
        316 / cover.naturalHeight,
      );
      const w = cover.naturalWidth * scale;
      const h = cover.naturalHeight * scale;
      context.drawImage(cover, x - (w - 316) / 2, y - (h - 316) / 2, w, h);
    }
    if (item) {
      context.fillStyle = "rgba(17, 17, 27, 0.94)";
      context.fillRect(x, y + 226, 316, 90);
      context.fillStyle = "#cdd6f4";
      context.font = "700 22px 'Zen Kaku Gothic New', sans-serif";
      drawTitle(context, item.title, x + 18, y + 242);
    }
    context.fillStyle = item ? "#89b4fa" : "#45475a";
    context.fillRect(x + 12, y + 12, 44, 32);
    context.fillStyle = "#11111b";
    context.font = "700 20px 'IBM Plex Mono', monospace";
    context.fillText(String(index + 1).padStart(2, "0"), x + 20, y + 17);
    context.restore();
  }
  context.fillStyle = "#a6adc8";
  context.font = "500 18px 'IBM Plex Mono', monospace";
  context.fillText("HONNE · 3×3", 54, 1154);
  context.fillText(`${items.length} OF 9`, 932, 1154);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (signal.aborted) reject(signal.reason);
      else if (result) resolve(result);
      else reject(new Error("The favorites image could not be created."));
    }, "image/png");
  });
  return { blob, missingCovers: covers.filter((cover) => !cover).length };
}
