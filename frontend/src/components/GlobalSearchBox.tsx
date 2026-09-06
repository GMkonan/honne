import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search } from "lucide-react";

export type SearchMediaType =
  | "anime"
  | "series"
  | "movie"
  | "book"
  | "manga"
  | "light_novel";

export interface SearchCatalogResult {
  provider: string;
  providerId: string;
  providerUrl: string;
  type: SearchMediaType;
  title: string;
  originalTitle?: string;
  description?: string;
  coverUrl?: string;
  releaseYear?: number;
  total?: number;
  subtitle?: string;
  communityRating?: number;
}

interface GlobalSearchBoxProps {
  id: string;
  className: string;
  label: string;
  placeholder: string;
  query: string;
  catalogResults: SearchCatalogResult[];
  unavailableCatalogs: number;
  catalogLoading: boolean;
  catalogError: string;
  onQueryChange: (query: string) => void;
  onActivate: (query: string) => void;
  onDeactivate: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenCatalog: (result: SearchCatalogResult) => void;
}

const typeLabels: Record<SearchMediaType, string> = {
  anime: "Anime",
  series: "Series",
  movie: "Movie",
  book: "Book",
  manga: "Manga",
  light_novel: "Light novel",
};

function roundRobin(results: SearchCatalogResult[]) {
  const groups = new Map<SearchMediaType, SearchCatalogResult[]>();
  results.forEach((result) =>
    groups.set(result.type, [...(groups.get(result.type) || []), result])
  );
  const ordered: SearchCatalogResult[] = [];
  for (let index = 0; ordered.length < results.length; index++) {
    let added = false;
    groups.forEach((group) => {
      if (group[index]) {
        ordered.push(group[index]);
        added = true;
      }
    });
    if (!added) break;
  }
  return ordered.slice(0, 5);
}

export function GlobalSearchBox({
  id,
  className,
  label,
  placeholder,
  query,
  catalogResults,
  unavailableCatalogs,
  catalogLoading,
  catalogError,
  onQueryChange,
  onActivate,
  onDeactivate,
  onSubmit,
  onOpenCatalog,
}: GlobalSearchBoxProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const composingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const queryLength = Array.from(query.trim()).length;
  const validQuery = queryLength >= 3;
  const suggestions = useMemo(
    () => validQuery ? roundRobin(catalogResults) : [],
    [catalogResults, validQuery],
  );
  const suggestionKeys = suggestions.map((result) =>
    `${result.provider}:${result.providerId}`
  ).join("|");

  useEffect(() => {
    if (!open) return;
    function closeFromOutside(event: PointerEvent) {
      if (!formRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [open]);

  useEffect(() => setActiveIndex(-1), [query, suggestionKeys]);

  function close() {
    setOpen(false);
    setActiveIndex(-1);
    onDeactivate();
  }

  function changeQuery(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;
    onQueryChange(nextQuery);
    onActivate(nextQuery);
    setOpen(Array.from(nextQuery.trim()).length >= 3);
  }

  function select(result: SearchCatalogResult) {
    close();
    onOpenCatalog(result);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" || event.key === "Tab") {
      close();
      return;
    }
    if (!open || !suggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        event.key === "ArrowDown"
          ? current >= suggestions.length - 1 ? 0 : current + 1
          : current <= 0
          ? suggestions.length - 1
          : current - 1
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : suggestions.length - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      select(suggestions[activeIndex]);
    }
  }

  return (
    <form
      ref={formRef}
      className={`${className} global-search-box`}
      role="search"
      onSubmit={(event) => {
        if (composingRef.current) {
          event.preventDefault();
          return;
        }
        close();
        onSubmit(event);
      }}
    >
      <Search size={15} />
      <input
        value={query}
        maxLength={100}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open && validQuery}
        aria-controls={`${id}-suggestions`}
        aria-activedescendant={activeIndex >= 0
          ? `${id}-suggestion-${activeIndex}`
          : undefined}
        placeholder={placeholder}
        onChange={changeQuery}
        onFocus={() => {
          onActivate(query);
          if (validQuery) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
      />

      {open && validQuery && (
        <div className="search-suggestions">
          <div
            id={`${id}-suggestions`}
            role="listbox"
            aria-label="Catalog suggestions"
          >
            {suggestions.length > 0 && (
              <div className="suggestion-group" role="presentation">
                <span className="suggestion-group-label">Discover</span>
                {suggestions.map((result, index) => (
                  <button
                    id={`${id}-suggestion-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={activeIndex === index}
                    className={activeIndex === index ? "active" : ""}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() =>
                      select(result)}
                    key={`${result.provider}-${result.type}-${result.providerId}`}
                  >
                    <span
                      className="suggestion-cover"
                      style={result.coverUrl
                        ? {
                          backgroundImage: `url("${
                            result.coverUrl.replaceAll('"', "")
                          }")`,
                        }
                        : undefined}
                    />
                    <span className="suggestion-copy">
                      <strong>{result.title}</strong>
                      <small>
                        {typeLabels[result.type]}
                        {result.releaseYear ? ` · ${result.releaseYear}` : ""}
                      </small>
                    </span>
                    <span className="suggestion-source">Catalog</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="suggestion-status" role="status" aria-live="polite">
            {catalogLoading
              ? "Searching catalogs…"
              : catalogError
              ? "Catalog suggestions unavailable."
              : unavailableCatalogs > 0
              ? "Some catalogs are unavailable."
              : suggestions.length
              ? `${suggestions.length} suggestions available.`
              : "No catalog suggestions found."}
          </div>
          <button type="submit" className="search-view-all">
            View all results for “{query.trim()}”
          </button>
        </div>
      )}
    </form>
  );
}
