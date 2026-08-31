import { ensureSchema } from "./_lib/db.js";
import { userFromReq } from "./_lib/auth.js";
import { json, allow } from "./_lib/http.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["GET"])) return;
  await ensureSchema();
  const user = await userFromReq(req);
  if (!user) return json(res, 401, { error: "Не авторизован" });
  json(res, 200, { id: user.id, email: user.email || null, isGuest: !!user.is_guest });
}
