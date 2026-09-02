/* =========================================================================
   XAUCORE — OWNER access (separate from normal user auth).

   Purpose: let the site owner reach the real app even while the site is
   "closed" to visitors, and let the owner flip that switch — without a
   redeploy and without touching any simulator / user state.

   Design (cannot be bypassed from the browser):
   - A single secret lives ONLY on the server: env var  OWNER_KEY.
   - The owner submits it once -> the server hands back a signed cookie
     `xc_owner = <payload>.<hmac>` where
        signingKey = sha256("xaucore-owner-v2|" + OWNER_KEY)
        hmac       = HMAC-SHA256(payload, signingKey)     (base64url)
        payload    = base64url(JSON){ exp }               (30-day expiry)
     The cookie is HttpOnly + Secure + SameSite=Lax: DevTools can read it but
     cannot forge a new one without OWNER_KEY, and JS can't touch it at all.
   - If OWNER_KEY is unset the whole lock feature fails OPEN (never locks) so
     the site can't lock itself out. See api/_lib/gate.js.

   Runs on the Node.js runtime everywhere it's used (API routes, the Node
   middleware, and dev-server.js) so there is ONE implementation.
   ========================================================================= */
import crypto from "node:crypto";

const NS = "xaucore-owner-v2|";
export const OWNER_COOKIE = "xc_owner";
const DEFAULT_DAYS = 30;

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const ownerSecret = () => (process.env.OWNER_KEY || "").trim();

/** Is owner access configured at all? (env var present) */
export const ownerConfigured = () => ownerSecret().length > 0;

const signingKey = () => crypto.createHash("sha256").update(NS + ownerSecret()).digest();

function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Validate a submitted key against OWNER_KEY (constant-time). */
export function checkOwnerKey(input) {
  return ownerConfigured() && timingSafeEq(String(input ?? ""), ownerSecret());
}

/** Mint a fresh signed owner token. */
export function makeOwnerToken(days = DEFAULT_DAYS) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + days * 86400_000 }));
  const sig = b64url(crypto.createHmac("sha256", signingKey()).update(payload).digest());
  return `${payload}.${sig}`;
}

/** True iff `token` is a well-formed, correctly-signed, unexpired owner token. */
export function verifyOwnerToken(token) {
  if (!token || typeof token !== "string" || !ownerConfigured()) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = b64url(crypto.createHmac("sha256", signingKey()).update(payload).digest());
  if (!timingSafeEq(sig, expect)) return false;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof p.exp === "number" && p.exp > Date.now();
  } catch {
    return false;
  }
}

/** Parse a Cookie header string into a plain object. */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(/; */)) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** True iff the request's Cookie header carries a valid owner token. */
export const isOwnerRequest = (cookieHeader) =>
  verifyOwnerToken(parseCookies(cookieHeader)[OWNER_COOKIE]);

/** Set-Cookie value that installs the owner cookie. `secure:false` for http://localhost. */
export function ownerCookie(token, { secure = true, days = DEFAULT_DAYS } = {}) {
  const a = [`${OWNER_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.round(days * 86400)}`];
  if (secure) a.push("Secure");
  return a.join("; ");
}

/** Set-Cookie value that clears the owner cookie. */
export function clearOwnerCookie({ secure = true } = {}) {
  const a = [`${OWNER_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) a.push("Secure");
  return a.join("; ");
}
