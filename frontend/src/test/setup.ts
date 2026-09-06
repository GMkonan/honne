import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  cleanup();
  globalThis.history.replaceState(null, "", "/");
  globalThis.sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
