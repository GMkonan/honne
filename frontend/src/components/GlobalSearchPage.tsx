import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft, CircleAlert, Plus, RefreshCw, Search } from "lucide-react";
import {
  catalogCoverStyle,
  matchingSearchOperators,
  parseSearchQuery,
  type SearchCatalogResult,
  type SearchMediaType,
  type SearchScope,
  SearchScopeControl,
} from "./GlobalSearchBox.tsx";

type TypeFilter = "all" | SearchMediaType;

interface GlobalSearchPageProps {
  query: string;
  input: string;
  scope: SearchScope;
  inputScope: SearchScope;
  catalogResults: SearchCatalogResult[];
  unavailableTypes: SearchMediaType[];
  loading: boolean;
  error: string;
  onInput: (value: string) => void;
  onScopeChange: (scope: SearchScope) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onRetry: () => void;
  onOpenCatalog: (result: SearchCatalogResult) => void;
  onAddManually: () => void;
}

const typeOrder: SearchMediaType[] = [
  "anime",
  "series",
  "movie",
  "book",
  "manga",
  "light_novel",
  "game",
];

const typeLabels: Record<SearchMediaType, string> = {
  anime: "Anime",
  series: "Series",
  movie: "Movies",
  book: "Books",
  manga: "Manga",
  light_novel: "Light novels",
  game: "Games",
};

export function GlobalSearchPage({
  query,
  input,
  scope,
  inputScope,
  catalogResults,
  unavailableTypes,
  loading,
  error,
  onInput,
  onScopeChange,
  onSubmit,
  onBack,
  onRetry,
  onOpenCatalog,
  onAddManually,
}: GlobalSearchPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const [activeType, setActiveType] = useState<TypeFilter>("all");
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [activeOperator, setActiveOperator] = useState(-1);
  const parsedInput = parseSearchQuery(input, inputScope);
  const operatorSuggestions = matchingSearchOperators(input);
  const availableTypes = useMemo(
    () =>
      typeOrder.filter((type) =>
        catalogResults.some((result) => result.type === type)
      ),
    [catalogResults],
  );
  const visibleTypes = activeType === "all"
    ? availableTypes
    : availableTypes.filter((type) => type === activeType);
  const allProvidersUnavailable = Boolean(error) && catalogResults.length === 0;

  useEffect(() => setActiveType("all"), [query, scope]);
  useEffect(() => setActiveOperator(-1), [input]);
  useEffect(() => {
    if (activeType !== "all" && !availableTypes.includes(activeType)) {
      setActiveType("all");
    }
  }, [activeType, availableTypes]);

  function selectOperator(index: number) {
    const option = operatorSuggestions[index];
    if (!option) return;
    onScopeChange(option.scope);
    onInput(`${option.operator}:`);
    setOperatorOpen(false);
    setActiveOperator(-1);
    inputRef.current?.focus();
  }

  function handleOperatorKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (
      event.key === "Tab" && !event.shiftKey && operatorSuggestions.length > 0
    ) {
      event.preventDefault();
      selectOperator(activeOperator >= 0 ? activeOperator : 0);
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      setOperatorOpen(false);
      setActiveOperator(-1);
      return;
    }
    if (!operatorOpen || operatorSuggestions.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveOperator((current) =>
        event.key === "ArrowDown"
          ? current >= operatorSuggestions.length - 1 ? 0 : current + 1
          : current <= 0
          ? operatorSuggestions.length - 1
          : current - 1
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveOperator(
        event.key === "Home" ? 0 : operatorSuggestions.length - 1,
      );
    } else if (event.key === "Enter" && activeOperator >= 0) {
      event.preventDefault();
      selectOperator(activeOperator);
    }
  }

  return (
    <main className="page-container page-main search-page">
      <button className="back-button" type="button" onClick={onBack}>
        <ArrowLeft size={14} /> Back to Library
      </button>

      <header className="search-page-header">
        <div>
          <span className="eyebrow">Discover</span>
          <h1>Results for “{query}”</h1>
          <p>Find titles from the available metadata catalogs.</p>
          <form
            className="search-page-query"
            role="search"
            onSubmit={(event) => {
              if (composingRef.current) {
                event.preventDefault();
                return;
              }
              onSubmit(event);
            }}
          >
            <SearchScopeControl
              id="search-page"
              scope={inputScope}
              label="Refine search media type"
              onOpen={() => {
                setOperatorOpen(false);
                setActiveOperator(-1);
              }}
              onChange={onScopeChange}
            />
            <span className="search-page-input">
              <input
                ref={inputRef}
                value={input}
                maxLength={100}
                role="combobox"
                aria-label="Refine catalog search"
                aria-autocomplete="list"
                aria-expanded={operatorOpen && operatorSuggestions.length > 0}
                aria-controls="search-page-operator-suggestions"
                aria-activedescendant={activeOperator >= 0
                  ? `search-page-operator-${activeOperator}`
                  : undefined}
                placeholder="Try another title"
                onChange={(event) => {
                  const value = event.target.value;
                  onInput(value);
                  setOperatorOpen(matchingSearchOperators(value).length > 0);
                }}
                onFocus={() => setOperatorOpen(operatorSuggestions.length > 0)}
                onBlur={() => setOperatorOpen(false)}
                onKeyDown={handleOperatorKeyDown}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
              />
              {operatorOpen && operatorSuggestions.length > 0 && (
                <div
                  id="search-page-operator-suggestions"
                  className="search-page-operator-options"
                  role="listbox"
                  aria-label="Refine search operators"
                >
                  <span className="suggestion-group-label">
                    Search by type
                  </span>
                  {operatorSuggestions.map((option, index) => (
                    <button
                      id={`search-page-operator-${index}`}
                      type="button"
                      role="option"
                      aria-label={`Use ${option.operator}: search operator for ${option.label}`}
                      aria-selected={activeOperator === index}
                      className={activeOperator === index ? "active" : ""}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => selectOperator(index)}
                      key={option.operator}
                    >
                      <strong>{option.label}</strong>
                      <code>{option.operator}:</code>
                    </button>
                  ))}
                </div>
              )}
            </span>
            <button
              type="submit"
              disabled={Array.from(parsedInput.query.trim()).length < 2}
            >
              Search
            </button>
          </form>
        </div>
        <div className="search-overview" aria-live="polite">
          <span className="search-metric">
            <strong>{loading ? "—" : catalogResults.length}</strong>
            <small>Catalog results</small>
          </span>
          <span
            className={`search-provider-state ${
              allProvidersUnavailable
                ? "error"
                : unavailableTypes.length
                ? "partial"
                : loading
                ? "loading"
                : "ready"
            }`}
          >
            {allProvidersUnavailable
              ? "Catalogs unavailable"
              : unavailableTypes.length
              ? `${unavailableTypes.length} catalogs unavailable`
              : loading
              ? scope === "all"
                ? "Searching catalogs…"
                : `Searching ${typeLabels[scope]}…`
              : "Catalog search complete"}
          </span>
        </div>
      </header>

      <section className="search-section search-discover-section">
        <div className="search-section-title discover-heading">
          <div>
            <span className="eyebrow">From the catalogs</span>
            <h2>Catalog matches</h2>
          </div>
          <span>
            {loading ? "Searching…" : `${catalogResults.length} found`}
          </span>
        </div>

        {unavailableTypes.length > 0 && (
          <div className="partial-notice">
            <CircleAlert size={13} aria-hidden="true" />
            <span>
              Some catalogs could not respond:{" "}
              {unavailableTypes.map((type) => typeLabels[type]).join(", ")}.
            </span>
            <button type="button" onClick={onRetry}>
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        )}

        {!loading && availableTypes.length > 1 && (
          <div className="search-type-tabs" aria-label="Filter catalog results">
            <button
              type="button"
              className={activeType === "all" ? "active" : ""}
              aria-pressed={activeType === "all"}
              onClick={() =>
                setActiveType("all")}
            >
              All <span>{catalogResults.length}</span>
            </button>
            {availableTypes.map((type) => (
              <button
                type="button"
                className={activeType === type ? "active" : ""}
                aria-pressed={activeType === type}
                onClick={() => setActiveType(type)}
                key={type}
              >
                {typeLabels[type]}
                <span>
                  {catalogResults.filter((item) =>
                    item.type === type
                  ).length}
                </span>
              </button>
            ))}
          </div>
        )}

        {loading
          ? <SearchSkeleton />
          : allProvidersUnavailable
          ? (
            <div className="search-catalog-error" role="alert">
              <CircleAlert size={22} />
              <div>
                <h3>Catalog search is temporarily unavailable</h3>
                <p>{error}</p>
              </div>
              <button type="button" onClick={onRetry}>
                <RefreshCw size={13} /> Try again
              </button>
            </div>
          )
          : catalogResults.length === 0
          ? (
            <div className="search-no-results">
              <Search size={22} />
              <h3>No catalog matches found</h3>
              <p>Try another spelling or add the title manually below.</p>
            </div>
          )
          : (
            <div className="catalog-groups">
              {visibleTypes.map((type) => {
                const results = catalogResults.filter((item) =>
                  item.type === type
                );
                return (
                  <section className="catalog-group" key={type}>
                    <h3>
                      {typeLabels[type]} <span>{results.length} results</span>
                    </h3>
                    <div className="catalog-results">
                      {results.map((result) => (
                        <button
                          type="button"
                          className="catalog-result"
                          aria-label={`Review ${result.title} from ${
                            typeLabels[type]
                          }`}
                          onClick={() => onOpenCatalog(result)}
                          key={`${result.provider}-${result.providerId}`}
                        >
                          <span
                            className="search-result-cover"
                            style={catalogCoverStyle(result.coverUrl)}
                          />
                          <span className="catalog-result-copy">
                            <small>
                              {result.releaseYear || typeLabels[result.type]}
                            </small>
                            <strong>{result.title}</strong>
                            <em>
                              {result.originalTitle || result.subtitle ||
                                "Review details"}
                            </em>
                          </span>
                          <span className="review-result">Review →</span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
      </section>

      <section className="search-manual">
        <div>
          <span className="eyebrow">Still not there?</span>
          <h2>Add “{query}” manually</h2>
          <p>Create a local entry when a title is missing from the catalogs.</p>
        </div>
        <button type="button" onClick={onAddManually}>
          <Plus size={14} /> Add manually
        </button>
      </section>
    </main>
  );
}

function SearchSkeleton() {
  return (
    <div
      className="search-skeleton"
      role="status"
      aria-label="Loading catalog results"
    >
      {Array.from(
        { length: 6 },
        (_, index) => (
          <span aria-hidden="true" key={index}>
            <i />
            <b />
          </span>
        ),
      )}
    </div>
  );
}
