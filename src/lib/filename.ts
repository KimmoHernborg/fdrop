const MAX_BYTES = 255;

/**
 * Turn a client-supplied name into a safe single path segment.
 * Returns null when nothing usable is left.
 */
export function sanitizeFilename(input: string): string | null {
  let name = input.normalize("NFC");
  // Keep only the last path segment, whichever separator the client used.
  name = name.split(/[\\/]/).pop() ?? "";
  // Drop control characters and characters that are troublesome on common filesystems.
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  // No leading dots (hidden files, "." and "..") and no trailing dots/spaces.
  name = name.replace(/^\.+/, "").replace(/[. ]+$/, "");
  if (!name) return null;
  return truncateBytes(name, MAX_BYTES);
}

/** Shorten to a byte budget while keeping the extension. */
function truncateBytes(name: string, max: number): string {
  if (Buffer.byteLength(name) <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : "";
  const stem = [...(ext ? name.slice(0, dot) : name)];
  while (stem.length > 1 && Buffer.byteLength(stem.join("") + ext) > max) stem.pop();
  return stem.join("") + ext;
}

/** RFC 6266 header value that always forces a download. */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
