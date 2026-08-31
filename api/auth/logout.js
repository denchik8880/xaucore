import { db, ensureSchema } from "../_lib/db.js";
import { bearer } from "../_lib/auth.js";
import { json, allow } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  await ensureSchema();

  const tok = bearer(req);
  if (tok) await db.execute({ sql: "DELETE FROM sessions WHERE token = ?", args: [tok] });
  json(res, 200, { ok: true });
}
