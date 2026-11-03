import { useEffect } from "react";
import { type AppView, replaceInitialRoute } from "./appNavigation.ts";
import { loadPreferences } from "./services/preferences.ts";

export function useStartPage(
  view: AppView,
  onResolved: (view: AppView) => void,
  onError: (message: string) => void,
) {
  useEffect(() => {
    if (view !== "start") return;
    const controller = new AbortController();
    loadPreferences(controller.signal).then((preferences) => {
      if (
        !controller.signal.aborted &&
        replaceInitialRoute(preferences.startPage)
      ) onResolved(preferences.startPage);
    }).catch((caught: unknown) => {
      if (controller.signal.aborted || globalThis.location.hash) return;
      const message = caught instanceof Error
        ? caught.message
        : "Could not load the start page.";
      onError(
        `Could not load your start page. Showing Overview. ${message}`,
      );
      onResolved("overview");
    });
    return () => controller.abort();
  }, [view, onResolved, onError]);
}
