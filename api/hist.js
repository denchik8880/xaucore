/* =========================================================================
   The chart's history — every bar the account's market has made, kept past
   what the state blob holds (user 2026-09-28: «пускай история золота на
   графике хранится, когда человек только создал аккаунт»).

   The state keeps the newest few hundred bars of each timeframe; the driving
   device cuts the oldest off in blocks and each block lands here as one
   immutable chunk: (gen, tf, k) — the account's market generation (a reset
   starts a new one), the timeframe, the chunk's number (oldest = 0).

     GET    ?gen=&tf=&k=         one chunk ({ data } or { data: null })
     PUT    { gen, tf, k, data, sid }   only the session driving the market
     DELETE                      the whole history (a reset of the account)
   ========================================================================= */
import { db, ensureSchema } from "./_lib/db.js";
import { userFromReq } from "./_lib/auth.js";
import { json, allow, readJson } from "./_lib/http.js";

const MAX_CHUNK_BYTES = 256 * 1024;
const TFS = new Set(["M1", "M5", "M15", "M30", "H1", "H4", "D1"]);
const okGen = g => typeof g === "string" && /^[a-z0-9]{4,40}$/.test(g);
const okK = k => Number.isInteger(k) && k >= 0 && k < 1e7;

export default async function handler(req, res) {
  if (!allow(req, res, ["GET", "PUT", "DELETE"])) return;
  await ensureSchema();

  const user = await userFromReq(req);
  if (!user) return json(res, 401, { error: "Не авторизован" });

  if (req.method === "GET") {
    const q = req.query || {};
    const gen = String(q.gen || ""), tf = String(q.tf || ""), k = Number(q.k);
    if (!okGen(gen) || !TFS.has(tf) || !okK(k)) return json(res, 400, { error: "bad chunk" });
    const r = await db.execute({
      sql: "SELECT data FROM hist WHERE user_id = ? AND gen = ? AND tf = ? AND k = ?",
      args: [user.id, gen, tf, k],
    });
    return json(res, 200, { data: r.rows[0] ? String(r.rows[0].data) : null });
  }

  if (req.method === "PUT") {
    const body = await readJson(req);
    const gen = String((body && body.gen) || ""), tf = String((body && body.tf) || ""), k = Number(body && body.k);
    const data = body && body.data, sid = String((body && body.sid) || "");
    if (!okGen(gen) || !TFS.has(tf) || !okK(k) || typeof data !== "string") return json(res, 400, { error: "bad chunk" });
    if (data.length > MAX_CHUNK_BYTES) return json(res, 413, { error: "chunk too large" });
    // only the session that drives the market writes its history (as with the state)
    const now = Date.now();
    const lr = await db.execute({ sql: "SELECT lease_sid, lease_exp FROM states WHERE user_id = ?", args: [user.id] });
    const row = lr.rows[0];
    const holder = row && row.lease_sid && Number(row.lease_exp || 0) > now ? String(row.lease_sid) : null;
    if (holder && holder !== sid) return json(res, 409, { error: "Симуляция запущена в другой сессии" });
    await db.execute({
      sql: `INSERT INTO hist(user_id, gen, tf, k, data, at) VALUES(?,?,?,?,?,?)
            ON CONFLICT(user_id, gen, tf, k) DO UPDATE SET data = excluded.data, at = excluded.at`,
      args: [user.id, gen, tf, k, data, now],
    });
    // the first chunk of a market: whatever an earlier market (before a reset) left here goes
    if (k === 0) await db.execute({ sql: "DELETE FROM hist WHERE user_id = ? AND gen <> ?", args: [user.id, gen] });
    return json(res, 200, { ok: true });
  }

  // DELETE — the account's market was wiped
  await db.execute({ sql: "DELETE FROM hist WHERE user_id = ?", args: [user.id] });
  return json(res, 200, { ok: true });
}
