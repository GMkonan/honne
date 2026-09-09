import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Pencil, X } from "lucide-react";
import {
  type DetailLibraryMedia,
  type DetailMediaStatus,
} from "./MediaDetailPage.tsx";
import {
  mediaStatusLabel,
  mediaTracking,
  optionalNumberInputValue,
} from "../mediaTracking.ts";

export interface ManagedMediaValues {
  status: DetailMediaStatus;
  progress: number;
  total: number;
  rating: number;
  repeatCount: number;
  notes: string;
}

interface ManageMediaModalProps {
  item: DetailLibraryMedia;
  onClose: () => void;
  onEditDetails: () => void;
  onSave: (values: ManagedMediaValues) => Promise<void>;
}

const statuses: DetailMediaStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "paused",
  "dropped",
];

function safeHTTPURL(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : "";
  } catch {
    return "";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

export function ManageMediaModal(
  { item, onClose, onEditDetails, onSave }: ManageMediaModalProps,
) {
  const [form, setForm] = useState<ManagedMediaValues>({
    status: item.status,
    progress: item.progress,
    total: item.total,
    rating: item.rating,
    repeatCount: item.repeatCount || 0,
    notes: item.notes,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);

  useEffect(() => {
    triggerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    statusRef.current?.focus();
    return () => {
      if (restoreFocus.current) triggerRef.current?.focus();
    };
  }, []);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]",
      ) || [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleChange(
    event: ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) {
    const { name, value, type } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "number" ? Number(value) : value,
    }));
  }

  function handleEditDetails() {
    restoreFocus.current = false;
    triggerRef.current?.focus();
    onEditDetails();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (caught: unknown) {
      setError(errorMessage(caught));
      setSaving(false);
    }
  }

  const cover = safeHTTPURL(item.coverUrl.replaceAll('"', ""));
  const tracking = mediaTracking(item.type);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        className="modal manage-media-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-media-title"
        aria-describedby="manage-media-description"
        onKeyDown={handleDialogKeyDown}
      >
        <header className="modal-header manage-media-header">
          <div className="manage-media-context">
            {cover && (
              <img
                src={cover}
                alt=""
                onError={(event) => event.currentTarget.hidden = true}
              />
            )}
            <div>
              <span className="eyebrow">YOUR LIBRARY</span>
              <h2 id="manage-media-title">Manage {item.title}</h2>
              <p id="manage-media-description">
                Update your personal tracking without changing catalog details.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close management dialog"
          >
            <X />
          </button>
        </header>

        <form onSubmit={handleSubmit} aria-busy={saving}>
          <label>
            Status
            <select
              ref={statusRef}
              name="status"
              value={form.status}
              onChange={handleChange}
            >
              {statuses.map((status) => (
                <option value={status} key={status}>
                  {mediaStatusLabel(status, item.type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tracking.repeatLabel}
            <input
              type="number"
              name="repeatCount"
              min="0"
              max="1000"
              step="1"
              value={optionalNumberInputValue(form.repeatCount)}
              onChange={handleChange}
              placeholder="0"
            />
            <small>{tracking.repeatHelp}</small>
          </label>
          {tracking.tracksProgress && (
            <>
              <label>
                {tracking.progressLabel}
                <input
                  type="number"
                  name="progress"
                  min="0"
                  max={form.total > 0 ? form.total : undefined}
                  value={optionalNumberInputValue(form.progress)}
                  onChange={handleChange}
                  placeholder="0"
                />
                <small>
                  {form.total > 0
                    ? `${form.total} ${tracking.unitPlural} total`
                    : "No total set"}
                </small>
              </label>
              <label>
                {tracking.totalLabel}
                <input
                  type="number"
                  name="total"
                  min="0"
                  value={optionalNumberInputValue(form.total)}
                  onChange={handleChange}
                  placeholder="0"
                />
                <small>Measured in {tracking.unitPlural}.</small>
              </label>
            </>
          )}
          <label className="wide">
            Personal rating
            <input
              type="number"
              name="rating"
              min="0"
              max="10"
              step="1"
              value={optionalNumberInputValue(form.rating)}
              onChange={handleChange}
              placeholder="0"
            />
            <small>Leave blank to keep this title unrated.</small>
          </label>
          <label className="wide">
            Review / notes
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={5}
              placeholder="What did you think?"
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions manage-media-actions">
            <button
              type="button"
              className="edit-details-button"
              onClick={handleEditDetails}
            >
              Edit title details
            </button>
            <button type="button" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="primary-button"
              aria-disabled={saving}
            >
              <Pencil size={15} /> {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
