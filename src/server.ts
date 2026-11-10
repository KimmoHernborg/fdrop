import type { BunRequest } from "bun";
import { callback, currentUser, login, logout } from "./auth";
import { startCleanupTimer } from "./cleanup";
import { config } from "./config";
import { deleteFile, downloadFile, listFiles, uploadFile, type User } from "./files";
import app from "./web/index.html";

const unauthorized = () => Response.json({ error: "Sign in required." }, { status: 401 });
const forbidden = () => Response.json({ error: "Cross-origin request refused." }, { status: 403 });

/** Require a signed-in user. */
function authed<R extends Request>(handler: (req: R, user: User) => Response | Promise<Response>) {
  return (req: R) => {
    const user = currentUser(req);
    return user ? handler(req, user) : unauthorized();
  };
}

/** Require a signed-in user and a same-origin request (CSRF protection for state changes). */
function mutating<R extends Request>(handler: (req: R, user: User) => Response | Promise<Response>) {
  return authed<R>((req, user) =>
    req.headers.get("origin") === config.origin ? handler(req, user) : forbidden(),
  );
}

const server = Bun.serve({
  port: config.port,
  // Small headroom over the limit; the upload handler enforces the exact number.
  maxRequestBodySize: config.maxUploadBytes + 1024 * 1024,
  idleTimeout: 255,
  development: config.production ? false : { hmr: true, console: true },

  routes: {
    "/": app,

    "/healthz": new Response("ok"),

    "/auth/login": { GET: () => login() },
    "/auth/callback": { GET: (req) => callback(req) },
    "/auth/logout": { POST: mutating((req) => logout(req)) },

    "/api/me": {
      GET: authed((_req, user) =>
        Response.json({
          name: user.name,
          email: user.email,
          retentionDays: config.retentionDays,
          maxUploadBytes: config.maxUploadBytes,
        }),
      ),
    },

    "/api/files": {
      GET: authed((_req, user) => listFiles(user)),
      PUT: mutating((req, user) => uploadFile(req, user)),
    },

    "/api/files/:id": {
      DELETE: mutating((req: BunRequest<"/api/files/:id">, user) => deleteFile(req.params.id, user)),
    },

    // Public share links: no authentication on purpose.
    "/s/:id/:filename": {
      GET: (req) => downloadFile(req.params.id, req.params.filename),
    },
  },

  fetch() {
    return new Response("Not found\n", { status: 404 });
  },

  error(cause) {
    console.error(cause);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  },
});

startCleanupTimer();

console.log(
  `fdrop listening on ${server.url} (public URL ${config.baseUrl})` +
    (config.authDisabled ? " — AUTH DISABLED, development only" : ""),
);
