/* Per-user simulator state. The whole `S` object is stored as one JSON blob so
   the frozen state resumes byte-for-byte on any device. */
import { db, ensureSchema } from "./_lib/db.js";
import { userFromReq } from "./_lib/auth.js";
import { json, allow, readJson } from "./_lib/http.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET", "PUT", "POST", "DELETE"])) return;
  await ensureSchema();

  const user = await userFromReq(req);
  if (!user) return json(res, 401, { error: "Не авторизован" });

  if (req.method === "GET") {
    const r = await db.execute({
      sql: "SELECT data, updated_at FROM states WHERE user_id = ?",
      args: [user.id],
    });
    const row = r.rows[0];
    let state = null;
    if (row) { try { state = JSON.parse(row.data); } catch { /* corrupt row -> null */ } }
    return json(res, 200, { state, updatedAt: row ? Number(row.updated_at) : 0 });
  }

  if (req.method === "PUT" || req.method === "POST") {
    const body = await readJson(req);
    const state = body && body.state;
    if (!state || typeof state !== "object") return json(res, 400, { error: "bad state" });
    const t = Date.now();
    await db.execute({
      sql: `INSERT INTO states(user_id, data, updated_at) VALUES(?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      args: [user.id, JSON.stringify(state), t],
    });
    return json(res, 200, { updatedAt: t });
  }

  // DELETE
  await db.execute({ sql: "DELETE FROM states WHERE user_id = ?", args: [user.id] });
  return json(res, 200, { ok: true });
}
