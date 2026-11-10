import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import { db, type FileRow } from "./db";
import { attachmentDisposition, sanitizeFilename } from "./lib/filename";
import { ID_PATTERN, randomId } from "./lib/id";

export interface User {
  sub: string;
  name: string;
  email: string | null;
}

const insertFile = db.query(
  `INSERT INTO files (id, owner_sub, owner_name, filename, size, mime, created_at, expires_at)
   VALUES ($id, $owner_sub, $owner_name, $filename, $size, $mime, $created_at, $expires_at)`,
);
const selectByOwner = db.query<FileRow, [string, number]>(
  "SELECT * FROM files WHERE owner_sub = ? AND expires_at > ? ORDER BY created_at DESC",
);
const selectById = db.query<FileRow, [string]>("SELECT * FROM files WHERE id = ?");
const deleteById = db.query("DELETE FROM files WHERE id = ?");

export const fileDir = (id: string) => join(config.filesDir, id);
export const filePath = (row: Pick<FileRow, "id" | "filename">) => join(fileDir(row.id), row.filename);

export async function removeFileDir(id: string): Promise<void> {
  if (!ID_PATTERN.test(id)) return;
  await rm(fileDir(id), { recursive: true, force: true });
}

function toJson(row: FileRow) {
  return {
    id: row.id,
    filename: row.filename,
    size: row.size,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    url: `${config.baseUrl}/s/${row.id}/${encodeURIComponent(row.filename)}`,
  };
}

const error = (status: number, message: string) => Response.json({ error: message }, { status });

export function listFiles(user: User): Response {
  return Response.json(selectByOwner.all(user.sub, Date.now()).map(toJson));
}

export async function uploadFile(req: Request, user: User): Promise<Response> {
  const filename = sanitizeFilename(new URL(req.url).searchParams.get("name") ?? "");
  if (!filename) return error(400, "A valid file name is required.");

  const tooLarge = () =>
    error(413, `File is larger than the ${Math.floor(config.maxUploadBytes / 1024 / 1024)} MB limit.`);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > config.maxUploadBytes) return tooLarge();

  const id = randomId();
  const row: FileRow = {
    id,
    owner_sub: user.sub,
    owner_name: user.name,
    filename,
    size: 0,
    mime: req.headers.get("content-type") || "application/octet-stream",
    created_at: Date.now(),
    expires_at: Date.now() + config.retentionMs,
  };

  await mkdir(fileDir(id), { recursive: true });
  const writer = Bun.file(filePath(row)).writer();
  try {
    if (req.body) {
      for await (const chunk of req.body) {
        row.size += chunk.byteLength;
        if (row.size > config.maxUploadBytes) {
          await writer.end();
          await removeFileDir(id);
          return tooLarge();
        }
        writer.write(chunk);
        // Apply backpressure so a fast client cannot fill memory.
        await writer.flush();
      }
    }
    await writer.end();
  } catch (cause) {
    // Client went away or the disk failed: leave nothing behind.
    await Promise.resolve(writer.end()).catch(() => {});
    await removeFileDir(id);
    console.error(`upload of "${filename}" failed:`, cause);
    return error(400, "Upload was interrupted.");
  }

  insertFile.run({ ...row });
  return Response.json(toJson(row), { status: 201 });
}

export async function deleteFile(id: string, user: User): Promise<Response> {
  const row = ID_PATTERN.test(id) ? selectById.get(id) : null;
  // Same answer for "missing" and "not yours" so IDs cannot be probed.
  if (!row || row.owner_sub !== user.sub) return error(404, "File not found.");
  deleteById.run(id);
  await removeFileDir(id);
  return new Response(null, { status: 204 });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Public, unauthenticated download. */
export async function downloadFile(id: string, name: string): Promise<Response> {
  const notFound = new Response("Not found or expired.\n", { status: 404 });
  if (!ID_PATTERN.test(id)) return notFound;
  const row = selectById.get(id);
  if (!row || row.expires_at <= Date.now()) return notFound;
  if (name !== row.filename && safeDecode(name) !== row.filename) return notFound;

  const file = Bun.file(filePath(row));
  if (!(await file.exists())) return notFound;

  return new Response(file, {
    headers: {
      // Never let the browser render uploaded content on this origin.
      "Content-Type": "application/octet-stream",
      "Content-Disposition": attachmentDisposition(row.filename),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
