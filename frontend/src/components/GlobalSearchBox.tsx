import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown } from "lucide-react";

export type SearchMediaType =
  | "anime"
  | "series"
  | "movie"
  | "book"
  | "manga"
  | "light_novel"
  | "game";

export type SearchScope = "all" | SearchMediaType;

export const searchScopeOptions: { value: SearchScope; label: string }[] = [
  { value: "all", label: "All media" },
  { value: "anime", label: "Anime" },
  { value: "series", label: "Series" },
  { value: "movie", label: "Movies" },
  { value: "book", label: "Books" },
  { value: "manga", label: "Manga" },
  { value: "light_novel", label: "Light novels" },
  { value: "game", label: "Games" },
];

export const searchOperatorOptions: {
  operator: string;
  scope: SearchMediaType;
  label: string;
  aliases: string[];
}[] = [
  { operator: "anime", scope: "anime", label: "Anime", aliases: [] },
  { operator: "series", scope: "series", label: "Series", aliases: ["tv"] },
  {
    operator: "movie",
    scope: "movie",
    label: "Movies",
    aliases: ["movies"],
  },
  { operator: "book", scope: "book", label: "Books", aliases: ["books"] },
  { operator: "manga", scope: "manga", label: "Manga", aliases: [] },
  {
    operator: "light-novel",
    scope: "light_novel",
    label: "Light novels",
    aliases: ["light_novel", "lightnovel", "ln"],
  },
  { operator: "game", scope: "game", label: "Games", aliases: ["games"] },
];

export function parseSearchQuery(value: string, fallbackScope: SearchScope): {
  query: string;
  scope: SearchScope;
  operator: string;
} {
  const match = value.match(/^\s*([a-z_-]+)\s*:(.*)$/isu);
  if (!match) return { query: value, scope: fallbackScope, operator: "" };
  const candidate = match[1].toLocaleLowerCase("en");
  const option = searchOperatorOptions.find(({ operator, aliases }) =>
    operator === candidate || aliases.includes(candidate)
  );
  return option
    ? { query: match[2].trimStart(), scope: option.scope, operator: candidate }
    : { query: value, scope: fallbackScope, operator: "" };
}

export function matchingSearchOperators(value: string) {
  const candidate = value.trim().toLocaleLowerCase("en");
  if (!candidate || candidate.includes(":") || /\s/u.test(candidate)) return [];
  return searchOperatorOptions.filter(({ operator }) =>
    operator.startsWith(candidate)
  );
}

export interface SearchMediaCredit {
  name: string;
  role: string;
}

export interface CatalogRelation {
  relation: string;
  result: SearchCatalogResult;
}

export interface CatalogDetailResponse extends SearchCatalogResult {
  alternativeTitles: string[];
  relations: CatalogRelation[];
}

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
  format?: string;
  genres?: string[];
  credits?: SearchMediaCredit[];
  releaseStatus?: string;
  startDate?: string;
  endDate?: string;
  durationMinutes?: number;
  catalogTotal?: number;
  communityRating?: number;
  catalogPlatforms?: string[];
}

interface GlobalSearchBoxProps {
  id: string;
  className: string;
  label: string;
  placeholder: string;
  query: string;
  scope: SearchScope;
  scopeLabel: string;
  catalogResults: SearchCatalogResult[];
  unavailableCatalogs: number;
  catalogLoading: boolean;
  catalogError: string;
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: SearchScope) => void;
  onActivate: (query: string) => void;
  onDeactivate: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenCatalog: (result: SearchCatalogResult) => void;
}

export function catalogCoverStyle(value?: string) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username || parsed.password
    ) return undefined;
    return { backgroundImage: `url("${parsed.href.replaceAll('"', "%22")}")` };
  } catch {
    return undefined;
  }
}

const typeLabels: Record<SearchMediaType, string> = {
  anime: "Anime",
  series: "Series",
  movie: "Movie",
  book: "Book",
  manga: "Manga",
  light_novel: "Light novel",
  game: "Game",
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
  scope,
  scopeLabel,
  catalogResults,
  unavailableCatalogs,
  catalogLoading,
  catalogError,
  onQueryChange,
  onScopeChange,
  onActivate,
  onDeactivate,
  onSubmit,
  onOpenCatalog,
}: GlobalSearchBoxProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scopeButtonRef = useRef<HTMLButtonElement>(null);
  const scopeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const composingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const parsedQuery = parseSearchQuery(query, scope);
  const searchTerm = parsedQuery.query.trim();
  const queryLength = Array.from(searchTerm).length;
  const validQuery = queryLength >= 3;
  const operatorSuggestions = useMemo(
    () => matchingSearchOperators(query),
    [query],
  );
  const catalogSuggestions = useMemo(
    () => validQuery ? roundRobin(catalogResults) : [],
    [catalogResults, validQuery],
  );
  const optionCount = operatorSuggestions.length + catalogSuggestions.length;
  const popupOpen = open && (operatorSuggestions.length > 0 || validQuery);
  const selectedScopeLabel =
    searchScopeOptions.find((option) => option.value === scope)?.label ||
    "All media";
  const suggestionKeys = catalogSuggestions.map((result) =>
    `${result.provider}:${result.providerId}`
  ).join("|");

  useEffect(() => {
    if (!open && !scopeOpen) return;
    function closeFromOutside(event: PointerEvent) {
      if (!formRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [open, scopeOpen]);

  useEffect(() => setActiveIndex(-1), [query, scope, suggestionKeys]);

  function close() {
    setOpen(false);
    setScopeOpen(false);
    setActiveIndex(-1);
    onDeactivate();
  }

  function focusScopeOption(index: number) {
    requestAnimationFrame(() => scopeOptionRefs.current[index]?.focus());
  }

  function openScopeOptions(index: number) {
    setOpen(false);
    setActiveIndex(-1);
    setScopeOpen(true);
    focusScopeOption(index);
  }

  function selectScope(nextScope: SearchScope) {
    const nextQuery = parsedQuery.operator ? parsedQuery.query : query;
    setScopeOpen(false);
    if (nextQuery !== query) onQueryChange(nextQuery);
    onScopeChange(nextScope);
    onActivate(nextQuery);
    if (Array.from(nextQuery.trim()).length >= 3) setOpen(true);
    scopeButtonRef.current?.focus();
  }

  function handleScopeOptionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      setScopeOpen(false);
      scopeButtonRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      setScopeOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const lastIndex = searchScopeOptions.length - 1;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
      ? lastIndex
      : event.key === "ArrowDown"
      ? index === lastIndex ? 0 : index + 1
      : index === 0
      ? lastIndex
      : index - 1;
    scopeOptionRefs.current[nextIndex]?.focus();
  }

  function changeQuery(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;
    const nextParsedQuery = parseSearchQuery(nextQuery, scope);
    onQueryChange(nextQuery);
    onActivate(nextQuery);
    setOpen(
      matchingSearchOperators(nextQuery).length > 0 ||
        Array.from(nextParsedQuery.query.trim()).length >= 3,
    );
  }

  function select(result: SearchCatalogResult) {
    close();
    onOpenCatalog(result);
  }

  function selectOperator(index: number) {
    const option = operatorSuggestions[index];
    if (!option) return;
    const nextQuery = `${option.operator}:`;
    setOpen(false);
    setActiveIndex(-1);
    onScopeChange(option.scope);
    onQueryChange(nextQuery);
    onActivate(nextQuery);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (
      event.key === "Tab" && !event.shiftKey && operatorSuggestions.length > 0
    ) {
      event.preventDefault();
      selectOperator(
        activeIndex >= 0 && activeIndex < operatorSuggestions.length
          ? activeIndex
          : 0,
      );
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      close();
      return;
    }
    if (!popupOpen || optionCount === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        event.key === "ArrowDown"
          ? current >= optionCount - 1 ? 0 : current + 1
          : current <= 0
          ? optionCount - 1
          : current - 1
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : optionCount - 1);
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      if (activeIndex < operatorSuggestions.length) {
        selectOperator(activeIndex);
      } else {
        select(catalogSuggestions[activeIndex - operatorSuggestions.length]);
      }
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
      <span className="search-scope-control">
        <button
          ref={scopeButtonRef}
          type="button"
          className="search-scope-trigger"
          aria-haspopup="listbox"
          aria-expanded={scopeOpen}
          aria-controls={`${id}-scope-options`}
          onClick={() => {
            if (scopeOpen) setScopeOpen(false);
            else {
              const selectedIndex = searchScopeOptions.findIndex((option) =>
                option.value === scope
              );
              openScopeOptions(Math.max(selectedIndex, 0));
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const selectedIndex = searchScopeOptions.findIndex((option) =>
                option.value === scope
              );
              openScopeOptions(
                event.key === "ArrowUp"
                  ? searchScopeOptions.length - 1
                  : Math.max(selectedIndex, 0),
              );
            } else if (event.key === "Escape") setScopeOpen(false);
          }}
        >
          <span className="sr-only">
            {`${scopeLabel}: ${selectedScopeLabel}`}
          </span>
          <span aria-hidden="true">{selectedScopeLabel}</span>
          <ChevronDown
            className="search-scope-chevron"
            size={15}
            aria-hidden="true"
          />
        </button>
        {scopeOpen && (
          <div
            id={`${id}-scope-options`}
            className="search-scope-options"
            role="listbox"
            aria-label={scopeLabel}
          >
            {searchScopeOptions.map((option, index) => (
              <button
                ref={(element) => {
                  scopeOptionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={option.value === scope}
                className={option.value === scope ? "selected" : ""}
                onClick={() => selectScope(option.value)}
                onKeyDown={(event) => handleScopeOptionKeyDown(event, index)}
                key={option.value}
              >
                <span>{option.label}</span>
                {option.value === scope && (
                  <Check size={14} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        )}
      </span>
      <input
        ref={inputRef}
        value={query}
        maxLength={100}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={popupOpen}
        aria-controls={`${id}-suggestions`}
        aria-activedescendant={activeIndex >= 0
          ? `${id}-suggestion-${activeIndex}`
          : undefined}
        placeholder={placeholder}
        onChange={changeQuery}
        onFocus={() => {
          setScopeOpen(false);
          onActivate(query);
          if (operatorSuggestions.length > 0 || validQuery) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
      />

      {popupOpen && (
        <div className="search-suggestions">
          <div
            id={`${id}-suggestions`}
            role="listbox"
            aria-label={operatorSuggestions.length > 0
              ? catalogSuggestions.length > 0
                ? "Search suggestions"
                : "Search operators"
              : "Catalog suggestions"}
          >
            {operatorSuggestions.length > 0 && (
              <div className="suggestion-group" role="presentation">
                <span className="suggestion-group-label">Search by type</span>
                {operatorSuggestions.map((option, index) => (
                  <button
                    id={`${id}-suggestion-${index}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-label={`Use ${option.operator}: search operator for ${option.label}`}
                    aria-selected={activeIndex === index}
                    className={`operator-suggestion ${
                      activeIndex === index ? "active" : ""
                    }`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() =>
                      selectOperator(index)}
                    key={option.operator}
                  >
                    <strong>{option.label}</strong>
                    <code>{option.operator}:</code>
                  </button>
                ))}
              </div>
            )}
            {catalogSuggestions.length > 0 && (
              <div className="suggestion-group" role="presentation">
                <span className="suggestion-group-label">Discover</span>
                {catalogSuggestions.map((result, index) => {
                  const optionIndex = operatorSuggestions.length + index;
                  return (
                    <button
                      id={`${id}-suggestion-${optionIndex}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={activeIndex === optionIndex}
                      className={activeIndex === optionIndex ? "active" : ""}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() =>
                        select(result)}
                      key={`${result.provider}-${result.type}-${result.providerId}`}
                    >
                      <span
                        className="suggestion-cover"
                        style={catalogCoverStyle(result.coverUrl)}
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
                  );
                })}
              </div>
            )}
          </div>
          {(validQuery || catalogLoading || catalogError ||
            unavailableCatalogs > 0 || catalogSuggestions.length > 0) && (
            <div
              className="suggestion-status"
              role="status"
              aria-live="polite"
            >
              {catalogLoading
                ? parsedQuery.scope === "all"
                  ? "Searching catalogs…"
                  : `Searching ${typeLabels[parsedQuery.scope]}…`
                : catalogError
                ? "Catalog suggestions unavailable."
                : unavailableCatalogs > 0
                ? "Some catalogs are unavailable."
                : catalogSuggestions.length
                ? `${optionCount} suggestions available.`
                : "No catalog suggestions found."}
            </div>
          )}
          {validQuery && (
            <button type="submit" className="search-view-all">
              View all results for “{searchTerm}”
            </button>
          )}
        </div>
      )}
    </form>
  );
}
