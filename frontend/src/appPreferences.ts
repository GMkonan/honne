export const startPageOptions = [
  { value: "overview", label: "Overview" },
  { value: "library", label: "Library" },
  { value: "monthly_log", label: "Monthly Log" },
  { value: "activity", label: "Activity" },
] as const;

export type StartPage = typeof startPageOptions[number]["value"];

export interface AppPreferences {
  startPage: StartPage;
}

export function isStartPage(value: unknown): value is StartPage {
  return startPageOptions.some((option) => option.value === value);
}
