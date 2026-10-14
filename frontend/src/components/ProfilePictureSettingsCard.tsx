import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { RotateCcw, Upload, UserRound } from "lucide-react";

const maxAvatarBytes = 4 * 1024 * 1024;
const allowedAvatarTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

interface ProfilePictureSettingsCardProps {
  avatarUrl: string;
  profileName: string;
  onUpload: (file: File, signal: AbortSignal) => Promise<void>;
  onReset: (signal: AbortSignal) => Promise<void>;
}

export function ProfilePictureSettingsCard({
  avatarUrl,
  profileName,
  onUpload,
  onReset,
}: ProfilePictureSettingsCardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const customAvatar = avatarUrl.startsWith("/api/profile/avatar");

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
    if (!allowedAvatarTypes.has(selected.type)) {
      setFile(null);
      setError("Choose a JPEG, PNG, WebP, or GIF image.");
      event.target.value = "";
      return;
    }
    if (selected.size > maxAvatarBytes) {
      setFile(null);
      setError("Choose an image no larger than 4 MiB.");
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
      setFeedback("Profile picture saved.");
    } catch (caught: unknown) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not save the profile picture.",
        );
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setWorking(false);
    }
  }

  async function reset() {
    if (!customAvatar || working) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setWorking(true);
    setError("");
    setFeedback("");
    try {
      await onReset(controller.signal);
      setFile(null);
      setFeedback("Default profile picture restored.");
    } catch (caught: unknown) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not reset the profile picture.",
        );
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setWorking(false);
    }
  }

  const displayedAvatar = previewUrl || avatarUrl;

  return (
    <section className="settings-card profile-picture-settings-card">
      <div className="settings-card-icon">
        <UserRound size={21} />
      </div>
      <div className="settings-card-copy">
        <div className="settings-card-title">
          <div>
            <h2>Profile picture</h2>
            <p>Choose the image shown with your Library profile.</p>
          </div>
          <span
            className={`connection-badge ${customAvatar ? "connected" : ""}`}
          >
            {customAvatar ? "Custom" : avatarUrl ? "Configured" : "Default"}
          </span>
        </div>
        <div className="profile-picture-settings-row">
          <div className="profile-picture-settings-preview">
            {displayedAvatar
              ? <img src={displayedAvatar} alt="Profile picture preview" />
              : (
                <span
                  role="img"
                  aria-label={`${profileName} default profile mark`}
                >
                  本音
                </span>
              )}
          </div>
          <p className="settings-note">
            Recommended: a square image at 512 × 512 px. JPEG, PNG, WebP, or GIF
            · up to 4 MiB. Stored locally and included in JSON backups.
          </p>
        </div>
        <div className="settings-actions profile-picture-settings-actions">
          <label className="file-picker-button">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={chooseFile}
              disabled={working}
            />
            <UserRound size={14} /> {file ? "Choose another" : "Choose image"}
          </label>
          <button
            type="button"
            className="primary-button"
            onClick={upload}
            disabled={!file || working}
          >
            <Upload size={14} /> {working && file ? "Saving…" : "Use picture"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!customAvatar || working}
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
