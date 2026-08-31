import { db, ensureSchema } from "./_lib/db.js";
import { json, allow } from "./_lib/http.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    await ensureSchema();
    await db.execute("SELECT 1");
    json(res, 200, { ok: true, ts: Date.now() });
  } catch (e) {
    json(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
}
