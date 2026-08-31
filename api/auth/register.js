import { ensureSchema } from "../_lib/db.js";
import { EMAIL_RE, createUser, createSession, getUserById, getUserByEmail, sessionInfo } from "../_lib/auth.js";
import { json, allow, readJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  await ensureSchema();

  const { email, password } = await readJson(req);
  const e = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return json(res, 400, { error: "Неверный email" });
  if (!password || String(password).length < 6) return json(res, 400, { error: "Пароль минимум 6 символов" });
  if (await getUserByEmail(e)) return json(res, 409, { error: "Этот email уже занят" });

  const id = await createUser(e, password, 0);
  const token = await createSession(id);
  json(res, 200, sessionInfo(await getUserById(id), token));
}
