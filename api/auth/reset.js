/* POST /api/auth/reset  { email, code, password }
   Checks the code from /api/auth/forgot, sets the new password, drops every
   session the account had (a reset signs the other devices out) and signs this
   one in. Five wrong tries burn the code. */
import { ensureSchema, db } from "../_lib/db.js";
import { EMAIL_RE, getUserByEmail, getUserById, hashPw, newSalt, timingSafeEq, createSession, sessionInfo } from "../_lib/auth.js";
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
    await db.execute({ sql: "DELETE FROM pw_resets WHERE email = ?", args: [e] });
    return json(res, 400, { error: "Код истёк — запросите новый" });
  }
  if (!timingSafeEq(hashPw(c, row.salt), row.code_hash)) {
    const tries = Number(row.tries) + 1;
    if (tries >= MAX_TRIES) {
      await db.execute({ sql: "DELETE FROM pw_resets WHERE email = ?", args: [e] });
      return json(res, 400, { error: "Слишком много попыток — запросите новый код" });
    }
    await db.execute({ sql: "UPDATE pw_resets SET tries = ? WHERE email = ?", args: [tries, e] });
    return json(res, 400, { error: "Неверный код", left: MAX_TRIES - tries });
  }

  const u = await getUserByEmail(e);
  if (!u) { await db.execute({ sql: "DELETE FROM pw_resets WHERE email = ?", args: [e] }); return json(res, 400, { error: "Аккаунт не найден" }); }

  const salt = newSalt();
  await db.execute({ sql: "UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?", args: [hashPw(password, salt), salt, u.id] });
  await db.execute({ sql: "DELETE FROM pw_resets WHERE email = ?", args: [e] });
  await db.execute({ sql: "DELETE FROM sessions WHERE user_id = ?", args: [u.id] });

  const token = await createSession(u.id);
  json(res, 200, sessionInfo(await getUserById(u.id), token));
}
