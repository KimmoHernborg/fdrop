export interface Me {
  name: string;
  email: string | null;
  retentionDays: number;
  maxUploadBytes: number;
}

export interface SharedFile {
  id: string;
  filename: string;
  size: number;
  createdAt: number;
  expiresAt: number;
  url: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status}).`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const getMe = () => request<Me>("/api/me");
export const getFiles = () => request<SharedFile[]>("/api/files");
export const deleteFile = (id: string) => request<void>(`/api/files/${id}`, { method: "DELETE" });
export const signOut = () => request<void>("/auth/logout", { method: "POST" });

/** Upload one file as a raw request body. XHR rather than fetch, for upload progress. */
export function uploadFile(
  file: File,
  onProgress: (fraction: number) => void,
): { done: Promise<SharedFile>; cancel: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<SharedFile>((resolve, reject) => {
    xhr.open("PUT", `/api/files?name=${encodeURIComponent(file.name)}`);
    xhr.responseType = "json";
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) resolve(xhr.response as SharedFile);
      else {
        const message = (xhr.response as { error?: string } | null)?.error;
        reject(new ApiError(xhr.status, message ?? `Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Connection lost during upload."));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled."));
    xhr.send(file);
  });
  return { done, cancel: () => xhr.abort() };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatTimeLeft(expiresAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((expiresAt - now) / 60000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}
