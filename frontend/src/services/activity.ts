import type { ActivityEvent } from "../types/activity.ts";
import { request } from "./http.ts";

export function listActivity(limit = 100, signal?: AbortSignal) {
  return request<ActivityEvent[]>(`/api/activity?limit=${limit}`, { signal });
}
