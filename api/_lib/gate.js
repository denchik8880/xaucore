/* =========================================================================
   XAUCORE — the access gate.

   ONE decision function, shared by:
     - middleware.js   (Vercel, before routing — page requests + /api/auth/*)
     - dev-server.js   (the same, locally, on every request)

   It answers: given a request path + its Cookie header, should this request
   see the real site, the "closed" page, or a 503 (for API calls)?

   Guarantees:
   - Fails OPEN. No OWNER_KEY  -> never locks. DB error -> last known / open.
   - The owner (valid signed cookie) always passes, locked or not.
   - Only page loads and the "sign in" API routes are blocked while closed.
     Everything else under /api (state sync, /api/lock, /api/owner, health, ...)
     stays reachable — it is already token- or owner-gated, and the owner needs
     /api/owner + /api/lock to get back in and flip the switch.
   ========================================================================= */
import { getSetting } from "./settings.js";
import { isOwnerRequest, ownerConfigured } from "./owner.js";

export { MAINTENANCE_HTML } from "./maintenance.js";

export const LOCK_KEY = "site_locked";

/** Static assets Vercel serves directly — middleware.js's `config.matcher`
    skips these, so the gate never sees them in prod. dev-server.js applies the
    same skip so local behaviour matches. KEEP IN SYNC with config.matcher. */
export const STATIC_SKIP = /^\/(?:fonts\/|wallet-bg|favicon\.ico|manifest\.webmanifest|_vercel\/)/;

/** The only API routes refused while the site is closed: new-session sign-in. */
const API_BLOCK_WHEN_CLOSED = new Set(["/api/auth/login", "/api/auth/register", "/api/auth/guest"]);

// short in-process cache so the gate doesn't hit the DB on every request
const TTL_MS = 5000;
const DB_TIMEOUT_MS = 1500; // Turso from a Vercel region is normally <50 ms
let _cache = { at: 0, locked: false };

/** Current lock flag, cached for a few seconds. Never throws, never hangs:
    a slow/unreachable DB just yields the last known value (default: open). */
export async function isLocked() {
  const now = Date.now();
  if (now - _cache.at < TTL_MS) return _cache.locked;
  try {
    const v = await Promise.race([
      getSetting(LOCK_KEY),
      new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), DB_TIMEOUT_MS)),
    ]);
    _cache = { at: now, locked: v === "1" || v === "true" };
  } catch {
    _cache.at = now; // keep the previous value, retry after TTL
  }
  return _cache.locked;
}

/** Drop the cache so the next check re-reads the DB (called right after a toggle). */
export function bustLockCache() {
  _cache.at = 0;
}

const norm = (p) => (String(p || "/").replace(/\/+$/, "") || "/");

/**
 * @param {{pathname:string, cookieHeader:string}} req
 * @returns {Promise<"pass"|"maintenance"|"block-api">}
 */
export async function gateDecision({ pathname, cookieHeader }) {
  if (!ownerConfigured()) return "pass";          // no key set -> feature disabled
  if (!(await isLocked())) return "pass";          // site open
  if (isOwnerRequest(cookieHeader)) return "pass"; // it's the owner

  const p = norm(pathname);
  if (p === "/api" || p.startsWith("/api/")) {
    return API_BLOCK_WHEN_CLOSED.has(p) ? "block-api" : "pass";
  }
  return "maintenance";
}
