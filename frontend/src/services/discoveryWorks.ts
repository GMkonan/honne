import type {
  SearchCatalogResult,
  SearchMediaType,
} from "../components/GlobalSearchBox.tsx";

export interface ContributorIdentity {
  provider: "tmdb" | "rawg";
  providerId: string;
  kind: "person" | "organization";
  relation: "director" | "production_company" | "developer" | "publisher";
}

function safeText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value.trim()).slice(0, maximum).join("");
}

function safeURL(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

function sanitizeResult(
  value: unknown,
  provider: ContributorIdentity["provider"],
  mediaType: SearchMediaType,
): SearchCatalogResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SearchCatalogResult>;
  const providerId = safeText(candidate.providerId, 40);
  const title = safeText(candidate.title, 200);
  if (
    candidate.provider !== provider || candidate.type !== mediaType ||
    !/^[1-9]\d*$/u.test(providerId) || !title
  ) return null;
  const releaseYear = typeof candidate.releaseYear === "number" &&
      Number.isInteger(candidate.releaseYear) && candidate.releaseYear >= 1 &&
      candidate.releaseYear <= 9999
    ? candidate.releaseYear
    : undefined;
  return {
    provider,
    providerId,
    providerUrl: safeURL(candidate.providerUrl),
    type: mediaType,
    title,
    originalTitle: safeText(candidate.originalTitle, 200) || undefined,
    coverUrl: safeURL(candidate.coverUrl) || undefined,
    releaseYear,
  };
}

export async function requestContributorWorks(
  identity: ContributorIdentity,
  mediaType: SearchMediaType,
  excludeId: string,
  page: number,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    provider: identity.provider,
    type: mediaType,
    id: identity.providerId,
    relation: identity.relation,
    page: String(page),
  });
  if (excludeId) params.set("exclude", excludeId);
  const response = await fetch(`/api/discovery/works?${params}`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(
      safeText(body.error, 300) ||
        "Contributor works could not be loaded. Please try again.",
    );
  }
  const body = await response.json() as {
    results?: unknown;
    page?: unknown;
  };
  if (body.page !== page || !Array.isArray(body.results)) {
    throw new Error("The metadata provider returned an invalid response.");
  }
  const results: SearchCatalogResult[] = [];
  const seen = new Set<string>();
  for (const value of body.results) {
    const result = sanitizeResult(value, identity.provider, mediaType);
    if (!result || seen.has(result.providerId)) continue;
    seen.add(result.providerId);
    results.push(result);
    if (results.length === 20) break;
  }
  return { results };
}
