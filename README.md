# fdrop

A small self-hosted file drop. Sign in, drop files, get one public link per file.
Links stop working and files are deleted after 7 days.

- Bun only: `Bun.serve`, `bun:sqlite`, Bun file I/O, and Bun's bundler for the React UI. No Vite, no separate build tool.
- Sign-in through OpenID Connect ([Pocket ID](https://pocket-id.org)).
- Share links look like `/s/<id>/<filename>` and need no sign-in. The id is 128 random bits.
- Files only. Dropped folders are refused.
- Each user sees and deletes only their own uploads.

## Run locally

```bash
bun install
```

```bash
cp .env.example .env
```

Fill in the Pocket ID values in `.env`, then:

```bash
bun dev
```

Open <http://fdrop.localhost:3000>. In Pocket ID, register the callback URL `<BASE_URL>/auth/callback`.

To work on the UI without Pocket ID, start with `AUTH_DISABLED=1 bun dev`. This signs everyone in as a fake
local user and the server refuses to start that way in production.

```bash
bun test
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `BASE_URL` | `http://localhost:3000` | Public URL, used for share links, the OIDC callback, and the CSRF origin check |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` (`/data` in Docker) | SQLite database and uploaded files |
| `OIDC_ISSUER` | required | Pocket ID URL |
| `OIDC_CLIENT_ID` | required | |
| `OIDC_CLIENT_SECRET` | required | |
| `RETENTION_DAYS` | `7` | Lifetime of new uploads; fractions allowed |
| `MAX_UPLOAD_MB` | `1024` | Largest single upload |
| `SESSION_DAYS` | `30` | How long a sign-in lasts |
| `CLEANUP_INTERVAL_MINUTES` | `15` | How often expired files and empty folders are swept |

Changing `RETENTION_DAYS` affects new uploads only; each file keeps the expiry it got when uploaded.

## Deploy

```bash
docker compose up -d --build
```

The compose file reads the variables above from the environment or a `.env` file next to it, and keeps data in
the `fdrop-data` volume. On Dokploy, create a Compose application from this repository, set the variables in
its Environment tab, and point a domain at port 3000.

Things to get right behind a reverse proxy:

- `BASE_URL` must be the exact public URL (scheme included). With `https://` the session cookie is marked `Secure`.
- The proxy's request body limit must be at least `MAX_UPLOAD_MB`, and it should not buffer uploads to disk.
- Register `<BASE_URL>/auth/callback` in Pocket ID.

## How it works

- Uploads stream to `DATA_DIR/files/<id>/<filename>`; metadata and sessions live in `DATA_DIR/fdrop.sqlite`.
- Downloads are always served as attachments with `application/octet-stream`, so an uploaded HTML or SVG file
  can never run on the app's origin.
- A sweep runs at startup and on an interval: it deletes expired files with their folders, removes empty
  folders and folders left by interrupted uploads (after an hour), and purges expired sessions.
- An expired link returns 404 immediately, even if the sweep has not run yet.

Not included: resumable uploads, range requests, per-file passwords, admin view.

## License

[MIT](LICENSE)
