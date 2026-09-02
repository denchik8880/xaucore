/* =========================================================================
   /api/lock — the "site closed" switch.

   GET             -> { locked, configured, isOwner }      (public; used by the
                        gate, the closed page and the Settings card)
   POST { locked } -> owner only. Writes the `site_locked` flag. Does NOT touch
                      any simulator or user state, and needs no redeploy.

   Allow-listed through the gate.
   ========================================================================= */
import { json, allow, readJson } from "./_lib/http.js";
import { getSetting, setSetting } from "./_lib/settings.js";
import { isOwnerRequest, ownerConfigured } from "./_lib/owner.js";
import { LOCK_KEY, bustLockCache } from "./_lib/gate.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET", "POST"])) return;

  if (req.method === "GET") {
    let locked = false;
    try { const v = await getSetting(LOCK_KEY); locked = v === "1" || v === "true"; } catch { /* default open */ }
    return json(res, 200, {
      locked,
      configured: ownerConfigured(),
      isOwner: isOwnerRequest(req.headers.cookie || ""),
    });
  }

  // POST -> toggle (owner only)
  if (!isOwnerRequest(req.headers.cookie || "")) {
    return json(res, 403, { error: "Требуется вход владельца" });
  }
  const body = await readJson(req);
  const locked = body.locked === true || body.locked === "1" || body.locked === 1;
  await setSetting(LOCK_KEY, locked ? "1" : "0");
  bustLockCache();
  return json(res, 200, { ok: true, locked });
}
