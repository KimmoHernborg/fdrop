import { useEffect, useState } from "react";
import { type SharedFile, formatSize, formatTimeLeft } from "./api";

export interface Upload {
  key: string;
  filename: string;
  size: number;
  progress: number;
  error: string | null;
}

interface Props {
  files: SharedFile[];
  uploads: Upload[];
  onDelete: (id: string) => Promise<void>;
  onCancel: (key: string) => void;
  onDismiss: (key: string) => void;
  onExpired: (id: string) => void;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function FileList({ files, uploads, onDelete, onCancel, onDismiss, onExpired }: Props) {
  const now = useNow(30_000);

  useEffect(() => {
    for (const file of files) if (file.expiresAt <= now) onExpired(file.id);
  }, [files, now, onExpired]);

  if (files.length === 0 && uploads.length === 0) {
    return <p className="empty">Nothing shared yet. Files you upload are listed here with their links.</p>;
  }

  return (
    <section aria-labelledby="files-heading">
      <h2 id="files-heading" className="list-heading">
        Your files
      </h2>
      <ul className="files">
        {uploads.map((upload) => (
          <UploadRow key={upload.key} upload={upload} onCancel={onCancel} onDismiss={onDismiss} />
        ))}
        {files.map((file) => (
          <FileRow key={file.id} file={file} now={now} onDelete={onDelete} />
        ))}
      </ul>
    </section>
  );
}

function UploadRow({
  upload,
  onCancel,
  onDismiss,
}: {
  upload: Upload;
  onCancel: (key: string) => void;
  onDismiss: (key: string) => void;
}) {
  const percent = Math.round(upload.progress * 100);
  return (
    <li className="file">
      <div className="file-main">
        <span className="file-name">{upload.filename}</span>
        {upload.error ? (
          <span className="file-meta file-error" role="alert">
            Not uploaded. {upload.error}
          </span>
        ) : (
          <span className="file-meta">
            Uploading {formatSize(upload.size)}, {percent}%
          </span>
        )}
      </div>
      <div className="file-actions">
        {upload.error ? (
          <button className="button" type="button" onClick={() => onDismiss(upload.key)}>
            Dismiss
          </button>
        ) : (
          <button className="button" type="button" onClick={() => onCancel(upload.key)}>
            Cancel
          </button>
        )}
      </div>
      {!upload.error && (
        <progress className="file-progress" max={100} value={percent} aria-label={`Uploading ${upload.filename}`} />
      )}
    </li>
  );
}

function FileRow({
  file,
  now,
  onDelete,
}: {
  file: SharedFile;
  now: number;
  onDelete: (id: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; the link itself is still right there to copy by hand.
      window.prompt("Copy this link", file.url);
    }
  };

  return (
    <li className="file">
      <div className="file-main">
        <a className="file-name" href={file.url}>
          {file.filename}
        </a>
        <span className="file-meta">
          {formatSize(file.size)}, link works for another {formatTimeLeft(file.expiresAt, now)}
        </span>
      </div>
      <div className="file-actions">
        {confirming ? (
          <>
            <button
              className="button button-danger"
              type="button"
              disabled={deleting}
              onClick={() => {
                setDeleting(true);
                onDelete(file.id).finally(() => setDeleting(false));
              }}
            >
              {deleting ? "Deleting" : "Delete file and link"}
            </button>
            <button className="button" type="button" disabled={deleting} onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            <button className="button button-primary" type="button" onClick={copy} aria-live="polite">
              {copied ? "Link copied" : "Copy link"}
            </button>
            <button className="button" type="button" onClick={() => setConfirming(true)}>
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}
