async function topNineRequest(
  signal: AbortSignal,
  mediaIds?: number[],
): Promise<number[]> {
  const response = await fetch("/api/top-nine", {
    method: mediaIds ? "PUT" : "GET",
    headers: { "Content-Type": "application/json" },
    body: mediaIds ? JSON.stringify({ mediaIds }) : undefined,
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body &&
        typeof body.error === "string"
      ? body.error
      : "Could not load or save your 3×3. Please try again.";
    throw new Error(message);
  }
  if (
    !body || typeof body !== "object" || !("mediaIds" in body) ||
    !Array.isArray(body.mediaIds) ||
    new Set(body.mediaIds).size !== body.mediaIds.length ||
    !body.mediaIds.every((id: unknown) =>
      typeof id === "number" && Number.isSafeInteger(id) && id > 0
    )
  ) {
    throw new Error("The 3×3 response was invalid. Please try again.");
  }
  return body.mediaIds;
}

export function loadTopNine(signal: AbortSignal): Promise<number[]> {
  return topNineRequest(signal);
}

export function saveTopNine(
  mediaIds: number[],
  signal: AbortSignal,
): Promise<number[]> {
  return topNineRequest(signal, mediaIds);
}
