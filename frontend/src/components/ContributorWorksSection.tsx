import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  catalogCoverStyle,
  type SearchCatalogResult,
  type SearchMediaType,
} from "./GlobalSearchBox.tsx";
import {
  type ContributorIdentity,
  requestContributorWorks,
} from "../services/discoveryWorks.ts";

export interface ContributorWorksTarget {
  key: string;
  name: string;
  kind: "person" | "organization";
  identities: ContributorIdentity[];
}

interface LibraryIdentity {
  provider: string;
  providerId: string;
  type: SearchMediaType;
}

interface ContributorWorksSectionProps {
  target: ContributorWorksTarget;
  source: SearchCatalogResult;
  libraryItems: LibraryIdentity[];
  onOpen: (result: SearchCatalogResult) => void;
}

const typeLabels: Partial<Record<SearchMediaType, string>> = {
  movie: "Movies",
  series: "Series",
  game: "Games",
};

function identityKey(identity: ContributorIdentity): string {
  return `${identity.provider}:${identity.relation}:${identity.providerId}`;
}

function resultKey(result: SearchCatalogResult): string {
  return `${result.provider}:${result.type}:${result.providerId}`;
}

function mergedResults(
  current: SearchCatalogResult[],
  incoming: SearchCatalogResult[],
): SearchCatalogResult[] {
  const seen = new Set(current.map(resultKey));
  return [
    ...current,
    ...incoming.filter((result) => {
      const key = resultKey(result);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  ];
}

export function ContributorWorksSection({
  target,
  source,
  libraryItems,
  onOpen,
}: ContributorWorksSectionProps) {
  const mediaTypes: SearchMediaType[] = target.identities[0]?.provider ===
      "rawg"
    ? ["game"]
    : ["movie", "series"];
  const initialType = mediaTypes.includes(source.type)
    ? source.type
    : mediaTypes[0];
  const relations = useMemo(
    () => [...new Set(target.identities.map((identity) => identity.relation))],
    [target.identities],
  );
  const [mediaType, setMediaType] = useState<SearchMediaType>(initialType);
  const [relation, setRelation] = useState("all");
  const [results, setResults] = useState<SearchCatalogResult[]>([]);
  const [page, setPage] = useState(1);
  const [remaining, setRemaining] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);

  const activeIdentities = useMemo(
    () =>
      target.identities.filter((identity) =>
        relation === "all" || identity.relation === relation
      ),
    [relation, target.identities],
  );

  useEffect(() => {
    const controller = new AbortController();
    const pending = page === 1
      ? activeIdentities
      : activeIdentities.filter((identity) =>
        remaining.has(identityKey(identity))
      );
    if (pending.length === 0) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    setError("");
    const excludeId = source.type === mediaType ? source.providerId : "";
    void Promise.allSettled(pending.map((identity) =>
      requestContributorWorks(
        identity,
        mediaType,
        excludeId,
        page,
        controller.signal,
      )
    )).then((outcomes) => {
      if (controller.signal.aborted) return;
      const incoming: SearchCatalogResult[] = [];
      const nextRemaining = new Set<string>();
      let failures = 0;
      outcomes.forEach((outcome, index) => {
        const identity = pending[index];
        if (outcome.status === "fulfilled") {
          incoming.push(...outcome.value.results);
          if (outcome.value.hasMore && page < 20) {
            nextRemaining.add(identityKey(identity));
          }
        } else if (
          !(outcome.reason instanceof DOMException &&
            outcome.reason.name === "AbortError")
        ) {
          failures += 1;
          nextRemaining.add(identityKey(identity));
        }
      });
      setResults((current) => mergedResults(current, incoming));
      setRemaining(nextRemaining);
      if (failures > 0) {
        setError(
          failures === pending.length
            ? "Works could not be loaded. Please try again."
            : "Some works could not be loaded.",
        );
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [
    activeIdentities,
    generation,
    mediaType,
    page,
    source.providerId,
    source.type,
  ]);

  function reset(nextType: SearchMediaType, nextRelation: string) {
    if (nextType === mediaType && nextRelation === relation) return;
    setMediaType(nextType);
    setRelation(nextRelation);
    setResults([]);
    setRemaining(new Set());
    setPage(1);
    setError("");
  }

  const libraryIdentities = new Set(
    libraryItems.map((item) =>
      `${item.provider}:${item.type}:${item.providerId}`
    ),
  );
  const title = target.kind === "person"
    ? `Works directed by ${target.name}`
    : `More from ${target.name}`;

  return (
    <section
      id="contributor-works"
      className="detail-context-section contributor-works"
      aria-labelledby="contributor-works-title"
    >
      <div className="detail-section-heading contributor-works-heading">
        <h2 id="contributor-works-title">{title}</h2>
        <div className="contributor-work-filters">
          {mediaTypes.length > 1 && (
            <div role="group" aria-label="Filter works by media type">
              {mediaTypes.map((type) => (
                <button
                  type="button"
                  aria-pressed={mediaType === type}
                  onClick={() => reset(type, relation)}
                  key={type}
                >
                  {typeLabels[type]}
                </button>
              ))}
            </div>
          )}
          {relations.length > 1 && (
            <div role="group" aria-label="Filter works by company role">
              <button
                type="button"
                aria-pressed={relation === "all"}
                onClick={() =>
                  reset(mediaType, "all")}
              >
                All roles
              </button>
              {relations.map((value) => (
                <button
                  type="button"
                  aria-pressed={relation === value}
                  onClick={() => reset(mediaType, value)}
                  key={value}
                >
                  {value === "developer" ? "Developer" : "Publisher"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading && results.length === 0 && (
        <p className="detail-metadata-status" role="status">Loading works…</p>
      )}
      {error && (
        <div className="detail-related-error" role="status">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setGeneration((value) => value + 1)}
          >
            <RefreshCw size={13} /> Try again
          </button>
        </div>
      )}
      {!loading && !error && results.length === 0 && (
        <p className="detail-metadata-status" role="status">
          No works were found for this filter.
        </p>
      )}
      {results.length > 0 && (
        <div className="detail-related-grid">
          {results.map((result) => {
            const inLibrary = libraryIdentities.has(resultKey(result));
            return (
              <button
                type="button"
                className="detail-related-item"
                aria-label={`Open ${result.title}${
                  inLibrary ? ", in your Library" : ""
                }`}
                onClick={() => onOpen(result)}
                key={resultKey(result)}
              >
                <span
                  className="detail-related-cover"
                  style={catalogCoverStyle(result.coverUrl)}
                  aria-hidden="true"
                />
                <span className="detail-related-copy">
                  <small>{typeLabels[result.type] || "Media"}</small>
                  <strong>{result.title}</strong>
                  <em>
                    {result.releaseYear || "Release unknown"}
                    {inLibrary ? " · In Library" : ""}
                  </em>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {results.length > 0 && remaining.size > 0 && !error && (
        <button
          type="button"
          className="contributor-load-more"
          onClick={() => setPage((value) => value + 1)}
          disabled={loading}
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
