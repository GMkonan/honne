import { vi } from "vitest";

type RouteHandler = (request: Request) => Response | Promise<Response>;

function isRouteHandler(value: unknown): value is RouteHandler {
  return typeof value === "function";
}

export interface FetchRouter {
  fetch: ReturnType<typeof vi.fn>;
  json: (
    method: string,
    path: string,
    value: unknown | RouteHandler,
    status?: number,
  ) => FetchRouter;
}

export function createFetchRouter(): FetchRouter {
  const routes = new Map<string, RouteHandler>();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(new URL(String(input), globalThis.location.origin), init);
    const url = new URL(request.url);
    const handler = routes.get(
      `${request.method} ${url.pathname}${url.search}`,
    );
    if (!handler) {
      throw new Error(
        `Unhandled request: ${request.method} ${url.pathname}${url.search}`,
      );
    }
    return await handler(request);
  });

  const router: FetchRouter = {
    fetch,
    json(method, path, value, status = 200) {
      routes.set(
        `${method} ${path}`,
        isRouteHandler(value)
          ? value
          : () =>
            new Response(JSON.stringify(value), {
              status,
              headers: { "Content-Type": "application/json" },
            }),
      );
      return router;
    },
  };
  return router;
}
