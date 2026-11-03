import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createFetchRouter } from "../test/fetch-router.ts";
import { StartPageSettingsCard } from "./StartPageSettingsCard.tsx";

describe("Start page settings", () => {
  it("loads the confirmed choice and saves via keyboard without optimistic confirmation or duplicate writes", async () => {
    const router = createFetchRouter();
    let finish: ((response: Response) => void) | undefined;
    router.json("GET", "/api/preferences", { startPage: "overview" });
    router.json("PUT", "/api/preferences", async (request: Request) => {
      expect(await request.json()).toEqual({ startPage: "library" });
      return new Promise<Response>((resolve) => finish = resolve);
    });
    vi.stubGlobal("fetch", router.fetch);
    const user = userEvent.setup();
    render(<StartPageSettingsCard />);
    const select = screen.getByRole("combobox", { name: "Initial tab" });
    expect(select).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("region", { name: "Start page" }).getAttribute(
        "aria-busy",
      ),
    ).toBe("true");
    await waitFor(() => expect(select).toHaveProperty("disabled", false));
    expect(select).toHaveProperty("value", "overview");
    expect(screen.getByRole("button", { name: "Save start page" }))
      .toHaveProperty("disabled", true);
    expect(screen.getAllByRole("option").map((option) => option.textContent))
      .toEqual(["Overview", "Library", "Monthly Log", "Activity"]);
    select.focus();
    await user.selectOptions(select, "library");
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Save start page" }),
    );
    await user.keyboard("{Enter}");
    expect(select).toHaveProperty("disabled", true);
    const saving = screen.getByRole("button", { name: "Saving…" });
    expect(saving).toHaveProperty("disabled", true);
    expect(screen.queryByText("Start page saved for all devices.")).toBeNull();
    await user.click(saving);
    expect(router.fetch.mock.calls.filter(([, init]) => init?.method === "PUT"))
      .toHaveLength(1);
    if (!finish) throw new Error("Save request was not started");
    await act(() =>
      Promise.resolve(finish?.(Response.json({ startPage: "library" })))
    );
    expect((await screen.findByRole("status")).textContent).toBe(
      "Start page saved for all devices.",
    );
    expect(select).toHaveProperty("value", "library");
    expect(select).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Save start page" }))
      .toHaveProperty("disabled", true);
  });

  it("preserves the selected value after a failed save and allows retry", async () => {
    const router = createFetchRouter();
    router.json("GET", "/api/preferences", { startPage: "library" });
    router.json(
      "PUT",
      "/api/preferences",
      { error: "Storage unavailable" },
      500,
    );
    vi.stubGlobal("fetch", router.fetch);
    const user = userEvent.setup();
    render(<StartPageSettingsCard />);
    const select = screen.getByRole("combobox", { name: "Initial tab" });
    await waitFor(() => expect(select).toHaveProperty("disabled", false));
    await user.selectOptions(select, "activity");
    await user.click(screen.getByRole("button", { name: "Save start page" }));
    const error = await screen.findByRole("alert");
    expect(error.textContent).toBe("Storage unavailable");
    expect(select.getAttribute("aria-describedby")).toContain(error.id);
    expect(select).toHaveProperty("value", "activity");
    expect(screen.queryByText("Start page saved for all devices.")).toBeNull();
    router.json("PUT", "/api/preferences", { startPage: "activity" });
    await user.click(screen.getByRole("button", { name: "Save start page" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "saved for all devices",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps loading failures separate from a default choice and supports retry", async () => {
    const router = createFetchRouter();
    router.json(
      "GET",
      "/api/preferences",
      { error: "Preferences unavailable" },
      503,
    );
    vi.stubGlobal("fetch", router.fetch);
    const user = userEvent.setup();
    render(<StartPageSettingsCard />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Preferences unavailable",
    );
    const select = screen.getByRole("combobox", { name: "Initial tab" });
    expect(select).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Save start page" }))
      .toHaveProperty("disabled", true);
    router.json("GET", "/api/preferences", { startPage: "monthly_log" });
    await user.click(screen.getByRole("button", { name: "Retry start page" }));
    await waitFor(() => expect(select).toHaveProperty("value", "monthly_log"));
    expect(select).toHaveProperty("disabled", false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry start page" }))
      .toBeNull();
  });

  it.each(["load", "save"])(
    "cancels an unmounted %s and ignores its late response",
    async (operation) => {
      const router = createFetchRouter();
      let signal: AbortSignal | undefined;
      let finish: ((response: Response) => void) | undefined;
      router.json("GET", "/api/preferences", { startPage: "overview" });
      router.json(
        operation === "load" ? "GET" : "PUT",
        "/api/preferences",
        (request: Request) => {
          signal = request.signal;
          return new Promise<Response>((resolve) => finish = resolve);
        },
      );
      vi.stubGlobal("fetch", router.fetch);
      const user = userEvent.setup();
      const mounted = render(<StartPageSettingsCard />);
      if (operation === "save") {
        const select = screen.getByRole("combobox", { name: "Initial tab" });
        await waitFor(() => expect(select).toHaveProperty("disabled", false));
        await user.selectOptions(select, "library");
        await user.click(
          screen.getByRole("button", { name: "Save start page" }),
        );
      }
      await waitFor(() => expect(signal).toBeDefined());
      mounted.unmount();
      expect(signal?.aborted).toBe(true);
      await act(() =>
        Promise.resolve(finish?.(Response.json({ startPage: "library" })))
      );
      expect(screen.queryByText("Start page saved for all devices."))
        .toBeNull();
    },
  );
});
