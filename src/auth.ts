import * as oidc from "openid-client";
import { config } from "./config";
import { db, type OidcStateRow, type SessionRow } from "./db";
import type { User } from "./files";
import { randomId } from "./lib/id";

const SESSION_COOKIE = "fdrop_session";
const STATE_COOKIE = "fdrop_login";
const STATE_TTL_MS = 10 * 60 * 1000;

const DEV_USER: User = { sub: "dev", name: "Local Dev", email: "dev@localhost" };

const insertState = db.query(
  "INSERT INTO oidc_states (state, code_verifier, nonce, created_at) VALUES (?, ?, ?, ?)",
);
const takeState = db.query<OidcStateRow, [string]>("DELETE FROM oidc_states WHERE state = ? RETURNING *");
const insertSession = db.query(
  "INSERT INTO sessions (id, sub, name, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const selectSession = db.query<SessionRow, [string, number]>(
  "SELECT * FROM sessions WHERE id = ? AND expires_at > ?",
);
const deleteSession = db.query("DELETE FROM sessions WHERE id = ?");

// --- cookies -----------------------------------------------------------------

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function cookie(name: string, value: string, maxAgeSeconds: number): string {
  const attrs = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (config.secureCookies) attrs.push("Secure");
  return attrs.join("; ");
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

// --- OIDC --------------------------------------------------------------------

let discovered: Promise<oidc.Configuration> | null = null;

function provider(): Promise<oidc.Configuration> {
  const settings = config.oidc;
  if (!settings) throw new Error("OIDC is not configured");
  discovered ??= oidc
    .discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret)
    .catch((cause) => {
      discovered = null; // retry on the next sign-in instead of caching the failure
      throw cause;
    });
  return discovered;
}

export function currentUser(req: Request): User | null {
  if (config.authDisabled) return DEV_USER;
  const id = readCookie(req, SESSION_COOKIE);
  if (!id) return null;
  const session = selectSession.get(id, Date.now());
  return session ? { sub: session.sub, name: session.name, email: session.email } : null;
}

export async function login(): Promise<Response> {
  if (config.authDisabled) return redirect("/");
  try {
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(await provider(), {
      redirect_uri: config.oidc!.redirectUri,
      scope: "openid profile email",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    insertState.run(state, verifier, nonce, Date.now());
    // Tie the login attempt to this browser so a callback cannot be replayed into another one.
    return redirect(url.href, [cookie(STATE_COOKIE, state, STATE_TTL_MS / 1000)]);
  } catch (cause) {
    console.error("login failed:", cause);
    return redirect("/?error=provider");
  }
}

export async function callback(req: Request): Promise<Response> {
  if (config.authDisabled) return redirect("/");
  const clearState = cookie(STATE_COOKIE, "", 0);
  const params = new URL(req.url).searchParams;
  const state = params.get("state");
  const pending = state && state === readCookie(req, STATE_COOKIE) ? takeState.get(state) : null;
  if (!pending || Date.now() - pending.created_at > STATE_TTL_MS) {
    return redirect("/?error=state", [clearState]);
  }

  try {
    const provided = await provider();
    // Rebuild the URL from BASE_URL: behind a reverse proxy req.url has the internal host.
    const currentUrl = new URL(config.oidc!.redirectUri);
    currentUrl.search = params.toString();
    const tokens = await oidc.authorizationCodeGrant(provided, currentUrl, {
      pkceCodeVerifier: pending.code_verifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    });

    const claims: Record<string, unknown> = { ...tokens.claims() };
    const sub = String(claims.sub);
    if (!claims.name && !claims.preferred_username && !claims.email) {
      Object.assign(claims, await oidc.fetchUserInfo(provided, tokens.access_token, sub));
    }
    const email = typeof claims.email === "string" ? claims.email : null;
    const name = String(claims.name || claims.preferred_username || email || sub);

    const sessionId = randomId(32);
    const now = Date.now();
    insertSession.run(sessionId, sub, name, email, now, now + config.sessionMs);
    return redirect("/", [clearState, cookie(SESSION_COOKIE, sessionId, Math.floor(config.sessionMs / 1000))]);
  } catch (cause) {
    console.error("sign-in callback failed:", cause);
    return redirect("/?error=signin", [clearState]);
  }
}

export function logout(req: Request): Response {
  const id = readCookie(req, SESSION_COOKIE);
  if (id) deleteSession.run(id);
  return new Response(null, { status: 204, headers: { "Set-Cookie": cookie(SESSION_COOKIE, "", 0) } });
}
