/* =========================================================================
   XAUCORE — auth helpers: password hashing, opaque session tokens, lookups.
   No JWT library — a session is just a random 32-byte token stored in the DB.
   ========================================================================= */
import crypto from "node:crypto";
import { db } from "./db.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 365;   // 1 year
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const newId = () => crypto.randomBytes(12).toString("hex");
const newToken = () => crypto.randomBytes(32).toString("hex");
export const newSalt = () => crypto.randomBytes(16).toString("hex");
export const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString("hex");

export function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export async function createUser(email, password, isGuest) {
  const id = newId();
  const salt = newSalt();
  const ph = password ? hashPw(password, salt) : null;
  await db.execute({
    sql: "INSERT INTO users(id,email,pass_hash,salt,is_guest,created_at) VALUES(?,?,?,?,?,?)",
    args: [id, email || null, ph, salt, isGuest ? 1 : 0, Date.now()],
  });
  return id;
}

export async function getUserById(id) {
  const r = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  return r.rows[0] || null;
}

export async function getUserByEmail(email) {
  const r = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email] });
  return r.rows[0] || null;
}

export async function createSession(userId) {
  const token = newToken();
  await db.execute({
    sql: "INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)",
    args: [token, userId, Date.now(), Date.now() + SESSION_TTL_MS],
  });
  return token;
}

export function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (m) return m[1].trim();
  // navigator.sendBeacon() can't set headers -> allow ?token= for the unload beacon
  const t = req.query && req.query.token;
  if (t) return String(t).trim();
  return null;
}

/** Resolve the signed-in user from the request, or null. Prunes expired sessions occasionally. */
export async function userFromReq(req) {
  const tok = bearer(req);
  if (!tok) return null;
  const s = await db.execute({ sql: "SELECT user_id, expires_at FROM sessions WHERE token = ?", args: [tok] });
  const row = s.rows[0];
  if (!row || Number(row.expires_at) < Date.now()) return null;
  if (Math.random() < 0.02) {
    db.execute({ sql: "DELETE FROM sessions WHERE expires_at < ?", args: [Date.now()] }).catch(() => {});
  }
  return getUserById(row.user_id);
}

export const sessionInfo = (u, token) => ({
  token,
  id: u.id,
  email: u.email || null,
  isGuest: !!u.is_guest,
});
