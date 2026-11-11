import { resolve } from "node:path";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const production = process.env.NODE_ENV === "production";
const authDisabled = process.env.AUTH_DISABLED === "1";

if (authDisabled && production) {
  throw new Error("AUTH_DISABLED=1 is not allowed when NODE_ENV=production");
}

const port = num("PORT", 3000);
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/+$/, "");
const dataDir = resolve(process.env.DATA_DIR || "./data");

const DAY = 24 * 60 * 60 * 1000;

export const config = {
  production,
  port,
  baseUrl,
  origin: new URL(baseUrl).origin,
  secureCookies: baseUrl.startsWith("https://"),
  dataDir,
  filesDir: resolve(dataDir, "files"),
  dbPath: resolve(dataDir, "fdrop.sqlite"),
  retentionMs: num("RETENTION_DAYS", 7) * DAY,
  retentionDays: num("RETENTION_DAYS", 7),
  maxUploadBytes: Math.floor(num("MAX_UPLOAD_MB", 1024) * 1024 * 1024),
  sessionMs: num("SESSION_DAYS", 30) * DAY,
  cleanupIntervalMs: num("CLEANUP_INTERVAL_MINUTES", 15) * 60 * 1000,
  authDisabled,
  oidc: authDisabled
    ? null
    : {
        issuer: required("OIDC_ISSUER"),
        clientId: required("OIDC_CLIENT_ID"),
        clientSecret: required("OIDC_CLIENT_SECRET"),
        redirectUri: `${baseUrl}/auth/callback`,
      },
};
