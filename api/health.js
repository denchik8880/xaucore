import { db, ensureSchema } from "./_lib/db.js";
import { json, allow } from "./_lib/http.js";
import { mailConfigured } from "./_lib/mail.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  try {
    await ensureSchema();
    await db.execute("SELECT 1");
    // which build is actually live — so "did my fix reach the phone?" is one request, not a guess
    json(res, 200, { ok: true, ts: Date.now(), build: (process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0, 7), mail: mailConfigured() });
  } catch (e) {
    json(res, 500, { ok: false, error: String((e && e.message) || e) });
  }
}
