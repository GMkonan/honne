import { type FormEvent, useEffect, useRef, useState } from "react";
import { House } from "lucide-react";
import {
  type AppPreferences,
  isStartPage,
  type StartPage,
  startPageOptions,
} from "../appPreferences.ts";
import { loadPreferences, savePreferences } from "../services/preferences.ts";
import "./StartPageSettingsCard.css";

export function StartPageSettingsCard() {
  const [saved, setSaved] = useState<AppPreferences | null>(null);
  const [selected, setSelected] = useState<StartPage>("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const saveController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    loadPreferences(controller.signal).then((preferences) => {
      if (controller.signal.aborted) return;
      setSaved(preferences);
      setSelected(preferences.startPage);
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load the start page.",
      );
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [generation]);

  useEffect(() => () => saveController.current?.abort(), []);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved || loading || saving || selected === saved.startPage) return;
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const preferences = await savePreferences(
        { startPage: selected },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSaved(preferences);
      setSelected(preferences.startPage);
      setFeedback("Start page saved for all devices.");
    } catch (caught: unknown) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not save the start page.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        saveController.current = null;
        setSaving(false);
      }
    }
  }

  return (
    <section
      className="settings-card"
      aria-labelledby="start-page-settings-title"
      aria-busy={loading || saving}
    >
      <div className="settings-card-icon" aria-hidden="true">
        <House size={21} />
      </div>
      <div className="settings-card-copy">
        <h2 id="start-page-settings-title">Start page</h2>
        <p id="start-page-settings-help">
          Choose the initial tab for all devices. Direct links stay unchanged.
        </p>
        <form className="start-page-settings-form" onSubmit={handleSave}>
          <label className="start-page-settings-field" htmlFor="start-page">
            Initial tab
            <select
              id="start-page"
              value={selected}
              disabled={loading || saving || !saved}
              aria-describedby={`start-page-settings-help${
                error ? " start-page-settings-error" : ""
              }`}
              onChange={(event) => {
                if (isStartPage(event.target.value)) {
                  setSelected(event.target.value);
                  setFeedback("");
                }
              }}
            >
              {startPageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={loading || saving || !saved ||
              selected === saved.startPage}
          >
            {saving ? "Saving…" : "Save start page"}
          </button>
        </form>
        {loading && (
          <p className="settings-note" role="status">Loading start page…</p>
        )}
        {feedback && (
          <p className="settings-feedback" role="status">{feedback}</p>
        )}
        {error && (
          <p
            id="start-page-settings-error"
            className="settings-feedback error"
            role="alert"
          >
            {error}
          </p>
        )}
        {!loading && !saved && (
          <div className="settings-actions">
            <button
              type="button"
              onClick={() => setGeneration((current) => current + 1)}
            >
              Retry start page
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
