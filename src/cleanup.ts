import { readdir, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import { db } from "./db";
import { isUploading, removeFileDir } from "./files";

/** Folders without a database row are left alone this long, so in-flight uploads survive. */
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

const expiredFiles = db.query<{ id: string }, [number]>("SELECT id FROM files WHERE expires_at <= ?");
const deleteFile = db.query("DELETE FROM files WHERE id = ?");
const fileExists = db.query<{ id: string }, [string]>("SELECT id FROM files WHERE id = ?");
const deleteSessions = db.query("DELETE FROM sessions WHERE expires_at <= ?");
const deleteStates = db.query("DELETE FROM oidc_states WHERE created_at <= ?");

export interface CleanupResult {
  expired: number;
  emptyDirs: number;
  orphanDirs: number;
}

export async function runCleanup(now = Date.now()): Promise<CleanupResult> {
  const result: CleanupResult = { expired: 0, emptyDirs: 0, orphanDirs: 0 };

  // 1. Expired uploads: row first, so the link dies even if the disk removal fails.
  for (const { id } of expiredFiles.all(now)) {
    deleteFile.run(id);
    await removeFileDir(id);
    result.expired++;
  }

  // 2. Sweep the storage folder for empty and orphaned directories.
  for (const entry of await readdir(config.filesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(config.filesDir, entry.name);
    try {
      // An upload in progress has no row yet but must never be swept, however long it takes.
      const tracked = fileExists.get(entry.name) !== null || isUploading(entry.name);
      const fresh = now - (await stat(dir)).mtimeMs < ORPHAN_GRACE_MS;
      if ((await readdir(dir)).length === 0) {
        // An empty folder is either an upload that is just starting or leftover junk.
        if (tracked || fresh) continue;
        await rmdir(dir);
        result.emptyDirs++;
      } else if (!tracked && !fresh) {
        await rm(dir, { recursive: true, force: true });
        result.orphanDirs++;
      }
    } catch (cause) {
      console.error(`cleanup: could not process ${dir}:`, cause);
    }
  }

  // 3. Stale auth records.
  deleteSessions.run(now);
  deleteStates.run(now - OIDC_STATE_TTL_MS);

  return result;
}

export function startCleanupTimer(): Timer {
  const tick = () =>
    runCleanup()
      .then((r) => {
        if (r.expired || r.emptyDirs || r.orphanDirs) {
          console.log(
            `cleanup: ${r.expired} expired, ${r.emptyDirs} empty folders, ${r.orphanDirs} orphaned folders removed`,
          );
        }
      })
      .catch((cause) => console.error("cleanup failed:", cause));
  tick();
  return setInterval(tick, config.cleanupIntervalMs);
}
