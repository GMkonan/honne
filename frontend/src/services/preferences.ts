import { type AppPreferences, isStartPage } from "../appPreferences.ts";

async function preferencesRequest(
  signal: AbortSignal,
  preferences?: AppPreferences,
): Promise<AppPreferences> {
  const response = await fetch("/api/preferences", {
    method: preferences ? "PUT" : "GET",
    headers: { "Content-Type": "application/json" },
    body: preferences ? JSON.stringify(preferences) : undefined,
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body &&
        typeof body.error === "string"
      ? body.error
      : "Could not load or save the start page. Please try again.";
    throw new Error(message);
  }
  if (
    !body || typeof body !== "object" || !("startPage" in body) ||
    !isStartPage(body.startPage)
  ) {
    throw new Error("The start page response was invalid. Please try again.");
  }
  return { startPage: body.startPage };
}

export function loadPreferences(signal: AbortSignal): Promise<AppPreferences> {
  return preferencesRequest(signal);
}

export function savePreferences(
  preferences: AppPreferences,
  signal: AbortSignal,
): Promise<AppPreferences> {
  return preferencesRequest(signal, preferences);
}
