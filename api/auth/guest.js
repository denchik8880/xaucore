import { ensureSchema } from "../_lib/db.js";
import { createUser, createSession, getUserById, sessionInfo } from "../_lib/auth.js";
import { json, allow } from "../_lib/http.js";

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  await ensureSchema();

  const id = await createUser(null, null, 1);
  const token = await createSession(id);
  json(res, 200, sessionInfo(await getUserById(id), token));
}
