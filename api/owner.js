/* =========================================================================
   /api/owner — owner sign-in / sign-out (see api/_lib/owner.js for the design).

   GET                     -> { configured, isOwner }
   POST   { key }          -> validate key, Set-Cookie xc_owner   -> { ok, isOwner }
   DELETE                  -> clear the cookie                     -> { ok, isOwner:false }

   Allow-listed through the gate so the owner can sign in from the closed page.
   ========================================================================= */
import { json, allow, readJson } from "./_lib/http.js";
import {
  checkOwnerKey, ownerConfigured, makeOwnerToken,
  ownerCookie, clearOwnerCookie, isOwnerRequest,
} from "./_lib/owner.js";

const isLocalhost = (req) => /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(req.headers.host || "");

export default async function handler(req, res) {
  if (!allow(req, res, ["GET", "POST", "DELETE"])) return;
  const secure = !isLocalhost(req);

  if (req.method === "GET") {
    return json(res, 200, {
      configured: ownerConfigured(),
      isOwner: isOwnerRequest(req.headers.cookie || ""),
    });
  }

  if (req.method === "POST") {
    if (!ownerConfigured()) return json(res, 503, { error: "Владельческий доступ не настроен" });
    const { key } = await readJson(req);
    if (!checkOwnerKey(key)) return json(res, 401, { error: "Неверный ключ" });
    res.setHeader("Set-Cookie", ownerCookie(makeOwnerToken(), { secure }));
    return json(res, 200, { ok: true, isOwner: true });
  }

  // DELETE -> sign out of owner mode
  res.setHeader("Set-Cookie", clearOwnerCookie({ secure }));
  return json(res, 200, { ok: true, isOwner: false });
}
