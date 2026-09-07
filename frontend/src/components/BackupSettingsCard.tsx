import { Download, Library } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Could not download backup";
}

function downloadFilename(header: string | null): string {
  const match = header?.match(/filename="([A-Za-z0-9._-]+)"/u);
  return match?.[1] || "honne-backup.json";
}

export function BackupSettingsCard() {
  const [preparing, setPreparing] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function handleDownload() {
    if (preparing) return;
    const requestController = new AbortController();
    controller.current = requestController;
    setPreparing(true);
    setFeedback("");
    setFailed(false);

    try {
      const response = await fetch("/api/backup", {
        headers: { Accept: "application/json" },
        signal: requestController.signal,
      });
      if (!response.ok) {
        let message = "Could not prepare backup";
        try {
          const payload = await response.json() as { error?: string };
          if (payload.error) message = payload.error;
        } catch {
          // Keep the stable fallback when an intermediary returns a non-JSON body.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      if (requestController.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadFilename(
        response.headers.get("Content-Disposition"),
      );
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      setFeedback("Backup download started.");
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setFailed(true);
      setFeedback(errorMessage(caught));
    } finally {
      if (controller.current === requestController) {
        controller.current = null;
        setPreparing(false);
      }
    }
  }

  return (
    <section className="settings-card compact" aria-labelledby="backup-title">
      <div className="settings-card-icon">
        <Library size={21} />
      </div>
      <div className="settings-card-copy">
        <h2 id="backup-title">Local-first data</h2>
        <p className="settings-note">
          Your collection, activity journal, and pending sync changes live in
          the persistent Docker volume. Provider outages never block local
          edits.
        </p>
        <p className="settings-note">
          The downloaded snapshot can restore your Honne data. AniList
          authorization is intentionally excluded; reconnect it after a restore.
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleDownload}
            disabled={preparing}
            aria-busy={preparing}
          >
            <Download size={14} />
            {preparing ? "Preparing backup…" : "Download backup"}
          </button>
        </div>
        {feedback && (
          <p
            className={`settings-feedback ${failed ? "error" : ""}`}
            role={failed ? "alert" : "status"}
          >
            {feedback}
          </p>
        )}
      </div>
    </section>
  );
}
