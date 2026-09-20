/* POST /api/auth/forgot  { email, lang? }
   Sends a 6-digit code to the address of an existing account and stores only
   its hash. Answers the same way whether or not the address has an account —
   a forgotten-password form must not tell a stranger who is registered here. */
import { ensureSchema, db } from "../_lib/db.js";
import { EMAIL_RE, getUserByEmail, hashPw, newSalt } from "../_lib/auth.js";
import { json, allow, readJson } from "../_lib/http.js";
import { mailConfigured, sendMail, resetCodeMail } from "../_lib/mail.js";
import crypto from "node:crypto";

const CODE_TTL_MS = 15 * 60 * 1000;
const RESEND_AFTER_MS = 60 * 1000;      // one letter a minute per address

export default async function handler(req, res) {
  if (!allow(req, res, ["POST"])) return;
  await ensureSchema();

  const { email, lang } = await readJson(req);
  const e = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return json(res, 400, { error: "Неверный email" });
  if (!mailConfigured()) return json(res, 503, { error: "Отправка писем пока не настроена" });

  const u = await getUserByEmail(e);
  if (u) {
    const now = Date.now();
    const prev = await db.execute({ sql: "SELECT sent_at FROM pw_resets WHERE email = ?", args: [e] });
    const sentAt = prev.rows[0] ? Number(prev.rows[0].sent_at) : 0;
    if (now - sentAt < RESEND_AFTER_MS) {
      return json(res, 429, { error: "Код уже отправлен — подождите минуту", wait: Math.ceil((RESEND_AFTER_MS - (now - sentAt)) / 1000) });
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    const salt = newSalt();
    await db.execute({
      sql: "INSERT INTO pw_resets(email,user_id,code_hash,salt,expires_at,sent_at,tries) VALUES(?,?,?,?,?,?,0)" +
           " ON CONFLICT(email) DO UPDATE SET user_id=excluded.user_id,code_hash=excluded.code_hash,salt=excluded.salt," +
           "expires_at=excluded.expires_at,sent_at=excluded.sent_at,tries=0",
      args: [e, u.id, hashPw(code, salt), salt, now + CODE_TTL_MS, now],
    });
    const m = resetCodeMail(code, String(lang || "en").slice(0, 2));
    try {
      await sendMail({ to: e, subject: m.subject, text: m.text, html: m.html });
    } catch (err) {
      await db.execute({ sql: "DELETE FROM pw_resets WHERE email = ?", args: [e] }).catch(() => {});
      return json(res, 502, { error: "Письмо не отправилось — попробуйте позже" });
    }
  }
  json(res, 200, { sent: true, ttl: CODE_TTL_MS / 1000 });
}
