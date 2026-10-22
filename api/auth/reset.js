/* POST /api/auth/reset  { email, code, password }
   Checks the code from /api/auth/forgot, sets the new password, drops every
   session the account had (a reset signs the other devices out) and signs this
   one in. Five wrong tries burn the code. */
import { ensureSchema, db } from "../_lib/db.js";
import { EMAIL_RE, getUserByEmail, getUserById, hashPw, newSalt, timingSafeEq, newSession, sessionInfo } from "../_lib/auth.js";
import { json, allow, readJson } from "../_lib/http.js";

const MAX_TRIES = 5;

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  await ensureSchema();

  const { email, code, password } = await readJson(req);
  const e = String(email || "").trim().toLowerCase();
  const c = String(code || "").replace(/\D/g, "");
  if (!EMAIL_RE.test(e)) return json(res, 400, { error: "Неверный email" });
  if (c.length !== 6) return json(res, 400, { error: "Код — 6 цифр" });
  if (!password || String(password).length < 6) return json(res, 400, { error: "Пароль минимум 6 символов" });

  const r = await db.execute({ sql: "SELECT * FROM pw_resets WHERE email = ?", args: [e] });
  const row = r.rows[0];
  if (!row) return json(res, 400, { error: "Код не запрашивался — начните заново" });
  if (Number(row.expires_at) < Date.now()) {
    await db.execute({ sql: "DELETE FROM pw_resets WHERE email = ? AND salt = ?", args: [e, row.salt] });
    return json(res, 400, { error: "Код истёк — запросите новый" });
  }
  if (!timingSafeEq(hashPw(c, row.salt), row.code_hash)) {
    const attempt = await db.execute({
      sql: "UPDATE pw_resets SET tries = tries + 1 WHERE email = ? AND salt = ? AND tries < ? AND expires_at >= ? RETURNING tries",
      args: [e, row.salt, MAX_TRIES, Date.now()],
    });
    if (!attempt.rows.length) return json(res, 400, { error: "Код недействителен — запросите новый" });
    const tries = Number(attempt.rows[0].tries);
    if (tries >= MAX_TRIES) {
      await db.execute({ sql: "DELETE FROM pw_resets WHERE email = ? AND salt = ? AND tries >= ?", args: [e, row.salt, MAX_TRIES] });
      return json(res, 400, { error: "Слишком много попыток — запросите новый код" });
    }
    return json(res, 400, { error: "Неверный код", left: MAX_TRIES - tries });
  }

  const u = await getUserByEmail(e);
  if (!u) { await db.execute({ sql: "DELETE FROM pw_resets WHERE email = ? AND salt = ?", args: [e, row.salt] }); return json(res, 400, { error: "Аккаунт не найден" }); }

  const salt = newSalt();
  const session = newSession(u.id);
  // Consume the exact code checked above once; changing the password, issuing
  // its session and revoking older sessions either all commit or all roll back.
  const [consumed] = await db.batch([{
    sql: "DELETE FROM pw_resets WHERE email = ? AND salt = ? AND code_hash = ? AND tries < ? AND expires_at >= ? RETURNING user_id",
    args: [e, row.salt, row.code_hash, MAX_TRIES, Date.now()],
  }, {
    sql: "UPDATE users SET pass_hash = ?, salt = ? WHERE id = ? AND changes() > 0",
    args: [hashPw(password, salt), salt, u.id],
  }, {
    sql: "INSERT INTO sessions(token,user_id,created_at,expires_at) SELECT ?,?,?,? WHERE changes() > 0",
    args: [session.token, u.id, session.createdAt, session.expiresAt],
  }, {
    sql: "DELETE FROM sessions WHERE user_id = ? AND token <> ? AND EXISTS (SELECT 1 FROM sessions WHERE token = ?)",
    args: [u.id, session.token, session.token],
  }], "write");
  if (!consumed.rows.length) return json(res, 400, { error: "Код недействителен — запросите новый" });
  const token = session.token;
  json(res, 200, sessionInfo(await getUserById(u.id), token));
}
