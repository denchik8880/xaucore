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
// Check ownership in the write itself: a SELECT followed by an UPDATE lets a
// stale request overwrite a lease another device acquired between the two.
const MAY_WRITE = `(states.lease_sid IS NULL OR states.lease_sid = '' OR
                    COALESCE(states.lease_exp, 0) <= ? OR states.lease_sid = ?)`;
const ORDER_QUEUE = `CASE WHEN json_valid(states.ops) THEN
                      CASE WHEN json_type(states.ops) = 'array' THEN states.ops ELSE '[]' END
                    ELSE '[]' END`;

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
    // ?live=1 is the mirror poll: the small frame the driver publishes ~1/s plus
    // the lease + rev, WITHOUT the ~250 KB state blob. ?meta=1 is the same minus
    // the frame (just "who is driving / has anything changed").
    if (req.query && (req.query.meta || req.query.live)) {
      const wantLive = !!req.query.live;
      const r = await db.execute({
        sql: `SELECT updated_at, lease_sid, lease_exp, rev, live_at${wantLive ? ", live" : ""}
              FROM states WHERE user_id = ?`,
        args: [user.id],
      });
      const row = r.rows[0] || null;
      const out = {
        updatedAt: row ? Number(row.updated_at) : 0,
        rev: row ? Number(row.rev || 0) : 0,
        liveAt: row ? Number(row.live_at || 0) : 0,
        lease: leaseOf(row, sid, now),
      };
      if (wantLive && row && row.live) { try { out.live = JSON.parse(row.live); } catch { /* ignore */ } }
      return json(res, 200, out);
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

    // An order placed on a device that is not currently driving the market.
    // Trading is allowed from ANY device: the order is queued here and the
    // driver executes it through the real engine on its next heartbeat.
    if (body && body.op === "order") {
      const order = body.order;
      if (!order || typeof order !== "object") return json(res, 400, { error: "bad order" });
      const entry = JSON.stringify({ ...order, _id: `${now}-${Math.random().toString(36).slice(2, 8)}`, _at: now, _from: String(body.sid || "") });
      const r = await db.execute({
        sql: `INSERT INTO states(user_id, data, updated_at, ops, rev) VALUES(?,'null',0,json_array(json(?)),0)
              ON CONFLICT(user_id) DO UPDATE SET ops = json_insert(${ORDER_QUEUE}, '$[#]', json(?))
              WHERE json_array_length(${ORDER_QUEUE}) < 50
              RETURNING json_array_length(ops) AS pending`,
        args: [user.id, entry, entry],
      });
      if (!r.rows.length) return json(res, 429, { error: "Слишком много ордеров в очереди" });
      return json(res, 200, { queued: true, pending: Number(r.rows[0].pending) });
    }

    // Release the lease on the way out (tab hidden / closed) so another device
    // picks the market up in ~1s instead of waiting for the TTL.
    if (body && body.op === "release") {
      const sid = String(body.sid || "");
      await db.execute({
        sql: "UPDATE states SET lease_exp = 0 WHERE user_id = ? AND lease_sid = ?",
        args: [user.id, sid],
      });
      return json(res, 200, { ok: true });
    }

    // The mirror heartbeat: a few KB of price / positions / candle tips, written
    // ~1/s by the driver so other devices follow live. Touches only the `live`
    // column — the heavy state blob is left alone — renews the lease, and hands
    // back any orders other devices queued so the driver can execute them.
    if (body && body.op === "live") {
      const sid = String(body.sid || "");
      const frame = JSON.stringify(body.live || null);
      if (frame.length > 512 * 1024) return json(res, 413, { error: "live frame too large" });
      // Publish, read and drain form one transaction. Orders appended while a
      // heartbeat is in flight remain queued for the following heartbeat.
      const [written, queued] = await db.batch([{
        sql: `INSERT INTO states(user_id, data, updated_at, live, live_at, lease_sid, lease_exp, lease_at, rev, ops)
              VALUES(?,'null',0,?,?,?,?,?,0,'[]')
              ON CONFLICT(user_id) DO UPDATE SET live      = excluded.live,
                                                 live_at   = excluded.live_at,
                                                 lease_sid = excluded.lease_sid,
                                                 lease_exp = excluded.lease_exp
              WHERE ${MAY_WRITE}`,
        args: [user.id, frame, now, sid || null, now + LEASE_MS, now, now, sid],
      }, {
        sql: "SELECT ops FROM states WHERE user_id = ? AND lease_sid IS ?",
        args: [user.id, sid || null],
      }, {
        sql: "UPDATE states SET ops = '[]' WHERE user_id = ? AND lease_sid IS ?",
        args: [user.id, sid || null],
      }], "write");
      if (!written.rowsAffected) {
        const cur = leaseOf(await readRow(user.id), sid, Date.now());
        return json(res, 409, { error: "Симуляция запущена в другой сессии", lease: cur });
      }
      let ops = [];
      try { const q = JSON.parse((queued.rows[0] && queued.rows[0].ops) || "[]"); if (Array.isArray(q)) ops = q; } catch { /* corrupt queue */ }
      return json(res, 200, { ok: true, liveAt: now, ops,
                              lease: { holder: sid, exp: now + LEASE_MS, mine: true, free: false } });
    }

    if (!body || body.op !== "claim") return json(res, 400, { error: "bad op" });
    const sid = String(body.sid || "");
    if (!sid) return json(res, 400, { error: "sid required" });

    const exp = now + LEASE_MS;
    const claimed = await db.execute({
        sql: `INSERT INTO states(user_id, data, updated_at, lease_sid, lease_exp, lease_at, rev)
              VALUES(?,?,?,?,?,?,0)
              ON CONFLICT(user_id) DO UPDATE SET lease_sid = excluded.lease_sid,
                                                 lease_exp = excluded.lease_exp,
                                                 lease_at  = excluded.lease_at
              WHERE ? OR ${MAY_WRITE}`,
        args: [user.id, "null", 0, sid, exp, now, body.force ? 1 : 0, now, sid],
      });
    if (!claimed.rowsAffected) {
      const cur = leaseOf(await readRow(user.id), sid, Date.now());
      return json(res, 409, { error: "Терминал уже открыт в другой сессии", lease: cur, granted: false });
    }
    return json(res, 200, { granted: true, lease: { holder: sid, exp, mine: true, free: false } });
  }

  if (req.method === "PUT") {
    const body = await readJson(req);
    const state = body && body.state;
    const sid = String((body && body.sid) || (req.query && req.query.sid) || "");
    if (!state || typeof state !== "object") return json(res, 400, { error: "bad state" });

    const data = JSON.stringify(state);
    if (data.length > MAX_STATE_BYTES) return json(res, 413, { error: "state too large" });
    const exp = now + LEASE_MS;
    const written = await db.execute({
      sql: `INSERT INTO states(user_id, data, updated_at, lease_sid, lease_exp, lease_at, rev)
            VALUES(?,?,?,?,?,?,1)
            ON CONFLICT(user_id) DO UPDATE SET data       = excluded.data,
                                               updated_at = excluded.updated_at,
                                               lease_sid  = excluded.lease_sid,
                                               lease_exp  = excluded.lease_exp,
                                               rev        = states.rev + 1
            WHERE ${MAY_WRITE}
            RETURNING rev`,
      args: [user.id, data, now, sid || null, exp, now, now, sid],
    });
    if (!written.rows.length) {
      const row = await readRow(user.id);
      return json(res, 409, { error: "Симуляция запущена в другой сессии", lease: leaseOf(row, sid, Date.now()), rev: row ? Number(row.rev || 0) : 0 });
    }
    return json(res, 200, { updatedAt: now, rev: Number(written.rows[0].rev), lease: { holder: sid, exp, mine: true, free: false } });
  }

  // DELETE — wipe the account's simulation (used by "reset")
  await db.batch([
    { sql: "DELETE FROM states WHERE user_id = ?", args: [user.id] },
    { sql: "DELETE FROM hist WHERE user_id = ?", args: [user.id] },
  ], "write");
  return json(res, 200, { ok: true });
}
