import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { config } from "./config";

mkdirSync(config.filesDir, { recursive: true });

export const db = new Database(config.dbPath, { create: true, strict: true });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS files (
    id         TEXT PRIMARY KEY,
    owner_sub  TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    filename   TEXT NOT NULL,
    size       INTEGER NOT NULL,
    mime       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS files_owner ON files (owner_sub, created_at DESC);
  CREATE INDEX IF NOT EXISTS files_expiry ON files (expires_at);

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    sub        TEXT NOT NULL,
    name       TEXT NOT NULL,
    email      TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oidc_states (
    state         TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    nonce         TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
`);

export interface FileRow {
  id: string;
  owner_sub: string;
  owner_name: string;
  filename: string;
  size: number;
  mime: string;
  created_at: number;
  expires_at: number;
}

export interface SessionRow {
  id: string;
  sub: string;
  name: string;
  email: string | null;
  created_at: number;
  expires_at: number;
}

export interface OidcStateRow {
  state: string;
  code_verifier: string;
  nonce: string;
  created_at: number;
}
