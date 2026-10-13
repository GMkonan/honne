import { Download, Library, RotateCcw, Upload } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";

const maxBackupBytes = 32 * 1024 * 1024;

interface BackupPreview {
  version: number;
  items: number;
  activities: number;
  pendingAniListChanges: number;
}

function errorMessage(
  value: unknown,
  fallback = "Could not download backup",
): string {
  return value instanceof Error ? value.message : fallback;
}

function downloadFilename(header: string | null): string {
  const match = header?.match(/filename="([A-Za-z0-9._-]+)"/u);
  return match?.[1] || "honne-backup.json";
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

export function BackupSettingsCard(
  { anilistConnected = false, onRestored }: {
    anilistConnected?: boolean;
    onRestored?: () => void | Promise<void>;
  },
) {
  const [preparing, setPreparing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const downloadController = useRef<AbortController | null>(null);
  const restoreController = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => () => {
    downloadController.current?.abort();
    restoreController.current?.abort();
  }, []);

  async function handleDownload() {
    if (preparing) return;
    const requestController = new AbortController();
    downloadController.current = requestController;
    setPreparing(true);
    setFeedback("");
    setFailed(false);

    try {
      const response = await fetch("/api/backup", {
        headers: { Accept: "application/json" },
        signal: requestController.signal,
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Could not prepare backup"),
        );
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
      if (downloadController.current === requestController) {
        downloadController.current = null;
        setPreparing(false);
      }
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setRestoreFile(null);
    setPreview(null);
    setConfirmed(false);
    setFeedback("");
    setFailed(false);
    restoreController.current?.abort();
    if (!file) return;
    if (file.size > maxBackupBytes) {
      setFailed(true);
      setFeedback("Backup exceeds 32 MiB.");
      return;
    }

    const requestController = new AbortController();
    restoreController.current = requestController;
    setPreviewing(true);
    try {
      const response = await fetch("/api/backup/preview", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: file,
        signal: requestController.signal,
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Could not validate backup"),
        );
      }
      const nextPreview = await response.json() as BackupPreview;
      if (requestController.signal.aborted) return;
      setRestoreFile(file);
      setPreview(nextPreview);
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setFailed(true);
      setFeedback(errorMessage(caught, "Could not validate backup"));
    } finally {
      if (restoreController.current === requestController) {
        restoreController.current = null;
        setPreviewing(false);
      }
    }
  }

  function cancelRestore() {
    restoreController.current?.abort();
    setRestoreFile(null);
    setPreview(null);
    setConfirmed(false);
    setFeedback("");
    setFailed(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function handleRestore() {
    if (
      !restoreFile || !preview || !confirmed || restoring || anilistConnected
    ) {
      return;
    }
    const requestController = new AbortController();
    restoreController.current = requestController;
    setRestoring(true);
    setFeedback("");
    setFailed(false);
    try {
      const response = await fetch("/api/backup/restore", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Honne-Restore-Confirmation": "replace",
        },
        body: restoreFile,
        signal: requestController.signal,
      });
      if (!response.ok) {
        throw new Error(
          await responseError(response, "Could not restore backup"),
        );
      }
      const restored = await response.json() as BackupPreview;
      setRestoreFile(null);
      setPreview(null);
      setConfirmed(false);
      if (fileInput.current) fileInput.current.value = "";
      const successMessage = `Backup restored: ${restored.items} title${
        restored.items === 1 ? "" : "s"
      } and ${restored.activities} activity event${
        restored.activities === 1 ? "" : "s"
      }.`;
      setFeedback(successMessage);
      try {
        await onRestored?.();
      } catch {
        setFeedback(
          `${successMessage} Refresh the page to reload the restored data.`,
        );
      }
    } catch (caught: unknown) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setFailed(true);
      setFeedback(errorMessage(caught, "Could not restore backup"));
    } finally {
      if (restoreController.current === requestController) {
        restoreController.current = null;
        setRestoring(false);
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
          Download a portable JSON snapshot or restore one into SQLite. AniList
          authorization is intentionally excluded from backups.
        </p>
        <div className="settings-actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleDownload}
            disabled={preparing || restoring}
            aria-busy={preparing}
          >
            <Download size={14} />
            {preparing ? "Preparing backup…" : "Download backup"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (fileInput.current) {
                fileInput.current.value = "";
                fileInput.current.click();
              }
            }}
            disabled={previewing || restoring}
          >
            <Upload size={14} />
            {previewing ? "Checking backup…" : "Import backup"}
          </button>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept="application/json,.json"
            aria-label="Choose backup JSON"
            onChange={handleFile}
          />
        </div>

        {preview && restoreFile && (
          <div
            className="backup-restore-preview"
            aria-labelledby="restore-preview-title"
          >
            <div className="backup-restore-heading">
              <RotateCcw size={16} aria-hidden="true" />
              <div>
                <strong id="restore-preview-title">Ready to restore</strong>
                <span>{restoreFile.name}</span>
              </div>
            </div>
            <dl className="backup-restore-counts">
              <div>
                <dt>Titles</dt>
                <dd>{preview.items}</dd>
              </div>
              <div>
                <dt>Activity</dt>
                <dd>{preview.activities}</dd>
              </div>
              <div>
                <dt>AniList queue</dt>
                <dd>{preview.pendingAniListChanges}</dd>
              </div>
            </dl>
            <p>
              This replaces the current Library, Activity, counters, and AniList
              queue. Download the current backup first if you may need it again.
            </p>
            {anilistConnected && (
              <p className="backup-restore-warning" role="alert">
                Disconnect AniList before restoring so imported sync changes
                cannot run under the wrong account.
              </p>
            )}
            <label className="backup-restore-confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I understand that this replaces the current Honne data.
            </label>
            <div className="settings-actions">
              <button
                type="button"
                onClick={cancelRestore}
                disabled={restoring}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleRestore}
                disabled={!confirmed || anilistConnected || restoring}
                aria-busy={restoring}
              >
                {restoring ? "Restoring…" : "Replace with this backup"}
              </button>
            </div>
          </div>
        )}

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
