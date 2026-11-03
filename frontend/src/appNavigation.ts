import type { StartPage } from "./appPreferences.ts";

export type AppView =
  | StartPage
  | "favorites"
  | "settings"
  | "search"
  | "detail"
  | "start";

export function routeFromHash(): AppView {
  const hash = globalThis.location.hash;
  if (!hash) return "start";
  if (hash === "#library/list") return "library";
  if (hash === "#activity") return "activity";
  if (hash === "#favorites") return "favorites";
  if (["#monthly-log", "#highlights", "#recap"].includes(hash)) {
    return "monthly_log";
  }
  if (hash === "#settings") return "settings";
  if (hash.startsWith("#search")) return "search";
  if (hash.startsWith("#media/") || hash.startsWith("#catalog/")) {
    return "detail";
  }
  return "overview";
}

export function pageHash(page: Exclude<AppView, "detail" | "start">): string {
  if (page === "overview") return "#library";
  if (page === "library") return "#library/list";
  if (page === "monthly_log") return "#monthly-log";
  return `#${page}`;
}

export function replaceInitialRoute(page: StartPage): boolean {
  if (globalThis.location.hash) return false;
  globalThis.history.replaceState(globalThis.history.state, "", pageHash(page));
  return true;
}
