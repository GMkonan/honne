import { Check, type LucideIcon, SlidersHorizontal } from "lucide-react";
import type { TrackingMediaType } from "../mediaTracking.ts";
import { catalogCoverStyle } from "./GlobalSearchBox.tsx";
import "./LibraryMediaFilter.css";

interface LibraryMediaFilterProps {
  items: readonly { type: string; coverUrl: string }[];
  options: readonly {
    value: TrackingMediaType;
    label: string;
    jpLabel: string;
    icon: LucideIcon;
  }[];
  activeType: TrackingMediaType | "all";
  onChange: (type: TrackingMediaType | "all") => void;
}

export function LibraryMediaFilter(
  { items, options, activeType, onChange }: LibraryMediaFilterProps,
) {
  return (
    <section className="library-media-filter" aria-label="Media type filters">
      <h3 className="filter-label">Media type</h3>
      <div className="format-options">
        <button
          type="button"
          aria-pressed={activeType === "all"}
          className={activeType === "all" ? "active" : ""}
          onClick={() =>
            onChange("all")}
        >
          <SlidersHorizontal size={17} aria-hidden="true" />
          <span>
            <strong>All media</strong> <small>{items.length}</small>
          </span>
          {activeType === "all" && (
            <Check className="format-check" size={15} aria-hidden="true" />
          )}
        </button>
        {options.map(({ value, label, jpLabel, icon: Icon }) => {
          const group = items.filter((item) =>
            item.type === value
          );
          const cover = group.map((item) => catalogCoverStyle(item.coverUrl))
            .find((style) => style !== undefined);
          return (
            <button
              type="button"
              key={value}
              aria-pressed={activeType === value}
              className={`${activeType === value ? "active" : ""} ${
                cover ? "has-preview" : ""
              }`}
              style={cover}
              onClick={() => onChange(value)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>
                <strong>{label}</strong>{" "}
                <small>{jpLabel} · {group.length}</small>
              </span>
              {activeType === value && (
                <Check className="format-check" size={15} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
