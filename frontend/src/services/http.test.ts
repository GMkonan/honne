import { describe, expect, it, vi } from "vitest";
import { errorMessage, request, RequestError } from "./http.ts";

describe("request", () => {
  it("normalizes JSON, empty and error API responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ title: "Synthetic" }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Already exists", existingId: 42 }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response("not json", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(request<{ title: string }>("/json")).resolves.toEqual({
      title: "Synthetic",
    });
    await expect(request<null>("/empty")).resolves.toBeNull();

    const conflict = await request("/conflict").catch((error: unknown) =>
      error
    );
    expect(conflict).toBeInstanceOf(RequestError);
    if (!(conflict instanceof RequestError)) throw conflict;
    expect(conflict.message).toBe("Already exists");
    expect(conflict.existingId).toBe(42);

    await expect(request("/broken")).rejects.toThrow(
      "Something went wrong. Please try again.",
    );
    expect(errorMessage("failure")).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("aborts a request through the supplied AbortSignal", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const pending = request("/pending", { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
