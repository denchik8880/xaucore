/* =========================================================================
   Per-user simulator state — the account OWNS the simulation.

   The whole `S` object is one JSON blob, so a frozen state resumes
   byte-for-byte on any device. The problem that adds the lease below: the price
   engine runs in the BROWSER, so two devices signed into the same account each
   advanced their own market and then overwrote each other — same account, two
   different gold prices.

   Fix: exactly ONE session may drive the simulation at a time.

     - a session identifies itself with an opaque `sid` (per browser tab)
     - POST {op:"claim", sid}  takes the lease when it is free or expired
       ({force:true} steals it — the "continue here" button)
     - PUT  {state, sid}       is REFUSED (409) unless `sid` holds the lease,
       and renews it on success
     - GET                     always returns the authoritative state + who holds
       the lease, so a follower can mirror it or take over

   The lease is short (LEASE_MS) and renewed by every push, so closing the tab
   frees the simulation within seconds and the other device can pick it up.
   ========================================================================= */
import { db, ensureSchema } from "./_lib/db.js";
import { userFromReq } from "./_lib/auth.js";
import { json, allow, readJson } from "./_lib/http.js";

const LEASE_MS = 20000;          // a lease outlives a couple of missed pushes
const MAX_STATE_BYTES = 4 * 1024 * 1024;

async function readRow(userId) {
  const r = await db.execute({
    sql: "SELECT data, updated_at, lease_sid, lease_exp, rev FROM states WHERE user_id = ?",
    args: [userId],
  });
  return r.rows[0] || null;
}
const leaseOf = (row, sid, now) => {
  const holder = row && row.lease_sid ? String(row.lease_sid) : null;
  const exp = row ? Number(row.lease_exp || 0) : 0;
  const live = !!holder && exp > now;
  return { holder: live ? holder : null, exp: live ? exp : 0, mine: live && holder === sid, free: !live };
};

export default async function handler(req, res) {
  if (!allow(req, res, ["GET", "PUT", "POST", "DELETE"])) return;
  await ensureSchema();

  const user = await userFromReq(req);
  if (!user) return json(res, 401, { error: "Не авторизован" });

  const now = Date.now();

  if (req.method === "GET") {
    const sid = String((req.query && req.query.sid) || "");
    // ?meta=1 answers "who holds the lease / has anything changed" without
    // shipping the ~250 KB blob — that is what a waiting follower polls.
    if (req.query && req.query.meta) {
      const r = await db.execute({
        sql: "SELECT updated_at, lease_sid, lease_exp, rev FROM states WHERE user_id = ?",
        args: [user.id],
      });
      const row = r.rows[0] || null;
      return json(res, 200, {
        updatedAt: row ? Number(row.updated_at) : 0,
        rev: row ? Number(row.rev || 0) : 0,
        lease: leaseOf(row, sid, now),
      });
    }
    const row = await readRow(user.id);
    let state = null;
    if (row) { try { state = JSON.parse(row.data); } catch { /* corrupt row -> null */ } }
    return json(res, 200, {
      state,
      updatedAt: row ? Number(row.updated_at) : 0,
      rev: row ? Number(row.rev || 0) : 0,
      lease: leaseOf(row, sid, now),
    });
  }

  if (req.method === "POST") {
    const body = await readJson(req);
    if (!body || body.op !== "claim") return json(res, 400, { error: "bad op" });
    const sid = String(body.sid || "");
    if (!sid) return json(res, 400, { error: "sid required" });

    const row = await readRow(user.id);
    const cur = leaseOf(row, sid, now);
    // free, expired, already mine, or an explicit takeover -> the lease is ours
    if (!(cur.free || cur.mine || body.force)) {
      return json(res, 409, { error: "Терминал уже открыт в другой сессии", lease: cur, granted: false });
    }
    const exp = now + LEASE_MS;
    if (row) {
      await db.execute({
        sql: "UPDATE states SET lease_sid = ?, lease_exp = ?, lease_at = ? WHERE user_id = ?",
        args: [sid, exp, now, user.id],
      });
    } else {
      // no state yet (fresh account) — reserve the lease so the first device wins
      await db.execute({
        sql: `INSERT INTO states(user_id, data, updated_at, lease_sid, lease_exp, lease_at, rev)
              VALUES(?,?,?,?,?,?,0)
              ON CONFLICT(user_id) DO UPDATE SET lease_sid = excluded.lease_sid,
                                                 lease_exp = excluded.lease_exp,
                                                 lease_at  = excluded.lease_at`,
        args: [user.id, "null", 0, sid, exp, now],
      });
    }
    return json(res, 200, { granted: true, lease: { holder: sid, exp, mine: true, free: false } });
  }

  if (req.method === "PUT") {
    const body = await readJson(req);
    const state = body && body.state;
    const sid = String((body && body.sid) || (req.query && req.query.sid) || "");
    if (!state || typeof state !== "object") return json(res, 400, { error: "bad state" });

    const row = await readRow(user.id);
    const cur = leaseOf(row, sid, now);
    // Only the session driving the simulation may write it. Without this the
    // second device silently overwrites the first one's market.
    if (!(cur.free || cur.mine)) {
      return json(res, 409, { error: "Симуляция запущена в другой сессии", lease: cur, rev: row ? Number(row.rev || 0) : 0 });
    }

    const data = JSON.stringify(state);
    if (data.length > MAX_STATE_BYTES) return json(res, 413, { error: "state too large" });
    const exp = now + LEASE_MS;
    await db.execute({
      sql: `INSERT INTO states(user_id, data, updated_at, lease_sid, lease_exp, lease_at, rev)
            VALUES(?,?,?,?,?,?,1)
            ON CONFLICT(user_id) DO UPDATE SET data       = excluded.data,
                                               updated_at = excluded.updated_at,
                                               lease_sid  = excluded.lease_sid,
                                               lease_exp  = excluded.lease_exp,
                                               rev        = states.rev + 1`,
      args: [user.id, data, now, sid || null, exp, now],
    });
    const after = await readRow(user.id);
    return json(res, 200, { updatedAt: now, rev: after ? Number(after.rev || 0) : 1, lease: { holder: sid, exp, mine: true, free: false } });
  }

  // DELETE — wipe the account's simulation (used by "reset")
  await db.execute({ sql: "DELETE FROM states WHERE user_id = ?", args: [user.id] });
  return json(res, 200, { ok: true });
}
