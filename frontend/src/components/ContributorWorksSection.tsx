import { useEffect, useState } from "react";
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

interface ContributorWorksSectionProps {
  target: ContributorWorksTarget;
  source: SearchCatalogResult;
  libraryItems: Array<{ provider: string; providerId: string }>;
  onOpen: (result: SearchCatalogResult) => void;
}

const typeLabels: Partial<Record<SearchMediaType, string>> = {
  movie: "Movies",
  series: "Series",
  game: "Games",
};

function resultKey(result: SearchCatalogResult): string {
  return `${result.provider}:${result.type}:${result.providerId}`;
}

export function ContributorWorksSection({
  target,
  source,
  libraryItems,
  onOpen,
}: ContributorWorksSectionProps) {
  const [results, setResults] = useState<SearchCatalogResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void Promise.allSettled(
      target.identities.map((identity) =>
        requestContributorWorks(
          identity,
          source.type,
          source.providerId,
          1,
          controller.signal,
        )
      ),
    ).then((outcomes) => {
      if (controller.signal.aborted) return;
      const next: SearchCatalogResult[] = [];
      const seen = new Set<string>();
      let failures = 0;
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") {
          failures += 1;
          continue;
        }
        for (const result of outcome.value.results) {
          const key = resultKey(result);
          if (seen.has(key)) continue;
          seen.add(key);
          next.push(result);
        }
      }
      setResults(next);
      if (failures > 0) {
        setError(
          failures === outcomes.length
            ? "Works could not be loaded. Please try again."
            : "Some works could not be loaded.",
        );
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [generation, source.providerId, source.type, target.identities]);

  const libraryIdentities = new Set(
    libraryItems.map((item) => `${item.provider}:${item.providerId}`),
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
      <div className="detail-section-heading">
        <h2 id="contributor-works-title">{title}</h2>
      </div>
      {loading && (
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
          No works were found.
        </p>
      )}
      {results.length > 0 && (
        <div className="detail-related-grid">
          {results.map((result) => {
            const inLibrary = libraryIdentities.has(
              `${result.provider}:${result.providerId}`,
            );
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
    </section>
  );
}
