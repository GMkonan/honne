import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { Image, RotateCcw, Upload } from "lucide-react";

const maxBannerBytes = 8 * 1024 * 1024;
const allowedBannerTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

interface LibraryAppearanceSettingsCardProps {
  bannerUrl: string;
  onUpload: (file: File, signal: AbortSignal) => Promise<void>;
  onReset: (signal: AbortSignal) => Promise<void>;
}

export function LibraryAppearanceSettingsCard({
  bannerUrl,
  onUpload,
  onReset,
}: LibraryAppearanceSettingsCardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const nextPreviewUrl = URL.createObjectURL(file);
    setPreviewUrl(nextPreviewUrl);
    return () => URL.revokeObjectURL(nextPreviewUrl);
  }, [file]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] || null;
    setFeedback("");
    setError("");
    if (!selected) {
      setFile(null);
      return;
    }
    if (!allowedBannerTypes.has(selected.type)) {
      setFile(null);
      setError("Choose a JPEG, PNG, WebP, or GIF image.");
      event.target.value = "";
      return;
    }
    if (selected.size > maxBannerBytes) {
      setFile(null);
      setError("Choose an image no larger than 8 MiB.");
      event.target.value = "";
      return;
    }
    setFile(selected);
  }

  async function upload() {
    if (!file || working) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setError("");
    setFeedback("");
    try {
      await onUpload(file, controller.signal);
      setFile(null);
      setFeedback("Custom Library banner saved.");
    } catch (caught: unknown) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not save the banner.",
        );
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setWorking(false);
    }
  }

  async function reset() {
    if (!bannerUrl || working) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setError("");
    setFeedback("");
    try {
      await onReset(controller.signal);
      setFile(null);
      setFeedback("Default Library banner restored.");
    } catch (caught: unknown) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not reset the banner.",
        );
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setWorking(false);
    }
  }

  const displayedBanner = previewUrl || bannerUrl;

  return (
    <section className="settings-card appearance-settings-card">
      <div className="settings-card-icon">
        <Image size={21} />
      </div>
      <div className="settings-card-copy">
        <div className="settings-card-title">
          <div>
            <h2>Library banner</h2>
            <p>Use your own artwork without changing the installation files.</p>
          </div>
          <span className={`connection-badge ${bannerUrl ? "connected" : ""}`}>
            {bannerUrl ? "Custom" : "Default"}
          </span>
        </div>
        {displayedBanner && (
          <div
            className="banner-settings-preview"
            style={{ backgroundImage: `url("${displayedBanner}")` }}
            role="img"
            aria-label={previewUrl
              ? "Preview of the selected Library banner"
              : "Current custom Library banner"}
          />
        )}
        <p className="settings-note">
          Recommended: 1920 × 520 px, with the focal point near the center.
          JPEG, PNG, WebP, or GIF · up to 8 MiB. Stored locally, included in
          JSON backups, and cropped responsively in the Library.
        </p>
        <div className="settings-actions banner-settings-actions">
          <label className="file-picker-button">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={chooseFile}
              disabled={working}
            />
            <Image size={14} /> {file ? "Choose another" : "Choose image"}
          </label>
          <button
            type="button"
            className="primary-button"
            onClick={upload}
            disabled={!file || working}
          >
            <Upload size={14} /> {working && file ? "Saving…" : "Use banner"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!bannerUrl || working}
          >
            <RotateCcw size={14} /> Restore default
          </button>
        </div>
        {file && <p className="selected-file-name">Selected: {file.name}</p>}
        {feedback && (
          <p className="settings-feedback" role="status" aria-live="polite">
            {feedback}
          </p>
        )}
        {error && (
          <p className="settings-feedback error" role="alert">{error}</p>
        )}
      </div>
    </section>
  );
}
