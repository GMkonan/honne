const fallbackError = "Something went wrong. Please try again.";

export class RequestError extends Error {
  existingId?: number;
}

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      existingId?: number;
    };
    const error = new RequestError(body.error || fallbackError);
    error.existingId = body.existingId;
    throw error;
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : fallbackError;
}
