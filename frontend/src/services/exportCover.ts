const maxCoverBytes = 5 * 1024 * 1024;
const imageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

async function readCover(response: Response): Promise<Blob | null> {
  const type = response.headers.get("Content-Type")?.split(";")[0].trim()
    .toLowerCase() || "";
  if (
    !response.ok || !imageTypes.has(type) ||
    Number(response.headers.get("Content-Length")) > maxCoverBytes
  ) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxCoverBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([data], { type });
}

export async function loadExportCover(
  url: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement | null> {
  signal?.throwIfAborted();
  try {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) || parsed.username ||
      parsed.password
    ) return null;
  } catch {
    return null;
  }
  const sources: Array<{ url: string; credentials: RequestCredentials }> = [
    {
      url: `/api/images/cover?url=${encodeURIComponent(url)}`,
      credentials: "same-origin",
    },
    { url, credentials: "omit" },
  ];
  for (const source of sources) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timeout = globalThis.setTimeout(cancel, 10_000);
    try {
      const response = await fetch(source.url, {
        credentials: source.credentials,
        mode: "cors",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      const blob = await readCover(response);
      if (!blob) continue;
      const image = new Image();
      const objectURL = URL.createObjectURL(blob);
      let cancelDecode = () => {};
      try {
        image.decoding = "async";
        await new Promise<void>((resolve, reject) => {
          cancelDecode = () => {
            image.removeAttribute("src");
            reject(
              new DOMException("Cover loading was canceled.", "AbortError"),
            );
          };
          controller.signal.addEventListener("abort", cancelDecode, {
            once: true,
          });
          if (controller.signal.aborted) {
            cancelDecode();
            return;
          }
          image.src = objectURL;
          image.decode().then(resolve, reject);
        });
        signal?.throwIfAborted();
        if (
          controller.signal.aborted || image.naturalWidth < 1 ||
          image.naturalHeight < 1 || image.naturalWidth > 10_000 ||
          image.naturalHeight > 10_000 ||
          image.naturalWidth * image.naturalHeight > 16_000_000
        ) continue;
        return image;
      } finally {
        controller.signal.removeEventListener("abort", cancelDecode);
        URL.revokeObjectURL(objectURL);
      }
    } catch {
      signal?.throwIfAborted();
      // A failed cover is independent of the other tiles in the exported image.
    } finally {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
    }
  }
  return null;
}
