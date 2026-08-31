/* Turn a guest account into a real one, keeping its saved state. */
import { db, ensureSchema } from "../_lib/db.js";
import { userFromReq, EMAIL_RE, hashPw, newSalt } from "../_lib/auth.js";
import { json, allow, readJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  await ensureSchema();

  const user = await userFromReq(req);
  if (!user) return json(res, 401, { error: "Не авторизован" });
  if (!user.is_guest) return json(res, 400, { error: "Аккаунт уже создан" });

  const { email, password } = await readJson(req);
  const e = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return json(res, 400, { error: "Неверный email" });
  if (!password || String(password).length < 6) return json(res, 400, { error: "Пароль минимум 6 символов" });

  const taken = await db.execute({ sql: "SELECT 1 FROM users WHERE email = ? AND id <> ?", args: [e, user.id] });
  if (taken.rows.length) return json(res, 409, { error: "Этот email уже занят" });

  const salt = newSalt();
  await db.execute({
    sql: "UPDATE users SET email = ?, pass_hash = ?, salt = ?, is_guest = 0 WHERE id = ?",
    args: [e, hashPw(password, salt), salt, user.id],
  });
  json(res, 200, { email: e, isGuest: false });
}
