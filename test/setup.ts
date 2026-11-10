import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "bun:test";

// Every test run gets its own throwaway data directory and never talks to Pocket ID.
const dir = mkdtempSync(join(tmpdir(), "fdrop-test-"));
process.env.DATA_DIR = dir;
process.env.AUTH_DISABLED = "1";
process.env.NODE_ENV = "test";
process.env.BASE_URL = "http://fdrop.test";
process.env.MAX_UPLOAD_MB = "1";
process.env.RETENTION_DAYS = "7";

afterAll(() => rmSync(dir, { recursive: true, force: true }));
