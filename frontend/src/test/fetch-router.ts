import { vi } from "vitest";

type RouteHandler = (request: Request) => Response | Promise<Response>;

function isRouteHandler(value: unknown): value is RouteHandler {
  return typeof value === "function";
}

export interface FetchRouter {
  fetch: ReturnType<typeof vi.fn>;
  requests: Request[];
  json: (
    method: string,
    path: string,
    value: unknown | RouteHandler,
    status?: number,
  ) => FetchRouter;
  empty: (method: string, path: string, status?: number) => FetchRouter;
}

export function createFetchRouter(): FetchRouter {
  const routes = new Map<string, RouteHandler>();
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request
      ? new Request(input, init)
      : new Request(new URL(String(input), globalThis.location.origin), init);
    requests.push(request);
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
    requests,
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
    empty(method, path, status = 204) {
      routes.set(`${method} ${path}`, () => new Response(null, { status }));
      return router;
    },
  };
  return router;
}
