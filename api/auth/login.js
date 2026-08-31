import { ensureSchema } from "../_lib/db.js";
import { getUserByEmail, createSession, hashPw, timingSafeEq, sessionInfo } from "../_lib/auth.js";
import { json, allow, readJson } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  await ensureSchema();

  const { email, password } = await readJson(req);
  const e = String(email || "").trim().toLowerCase();
  const u = await getUserByEmail(e);
  if (!u || !u.pass_hash || !timingSafeEq(hashPw(password || "", u.salt), u.pass_hash)) {
    return json(res, 401, { error: "Неверный email или пароль" });
  }
  json(res, 200, sessionInfo(u, await createSession(u.id)));
}
