/* =========================================================================
   XAUCORE — server for the DEMO / SYNTHETIC XAUUSD trading simulator.

   Serves the static front-end and stores each user's FULL simulator state so
   the frozen state resumes exactly on any device. No real quotes, brokers or
   trading — everything is synthetic.

   Zero npm dependencies: node:http + node:sqlite + node:crypto (Node >= 22.5).
   ========================================================================= */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT) || 8777;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "xaucore.db");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 365;          // 1 year
const MAX_STATE_BYTES = 4 * 1024 * 1024;                   // 4 MB per user

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 4000;
  CREATE TABLE IF NOT EXISTS users(
    id         TEXT PRIMARY KEY,
    email      TEXT UNIQUE,
    pass_hash  TEXT,
    salt       TEXT,
    is_guest   INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions(
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS states(
    user_id    TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// prune expired sessions on boot and hourly
const pruneSessions = () => { try { db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now()); } catch (e) {} };
pruneSessions();
setInterval(pruneSessions, 60 * 60 * 1000).unref();

/* ---------------- helpers ---------------- */
const nowMs = () => Date.now();
const newId = () => crypto.randomBytes(12).toString("hex");
const newToken = () => crypto.randomBytes(32).toString("hex");
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function hashPw(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 64).toString("hex");
}
function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function createUser(email, password, isGuest) {
  const id = newId();
  const salt = crypto.randomBytes(16).toString("hex");
  const ph = password ? hashPw(password, salt) : null;
  db.prepare("INSERT INTO users(id,email,pass_hash,salt,is_guest,created_at) VALUES(?,?,?,?,?,?)")
    .run(id, email || null, ph, salt, isGuest ? 1 : 0, nowMs());
  return id;
}
function createSession(userId) {
  const token = newToken();
  db.prepare("INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)")
    .run(token, userId, nowMs(), nowMs() + SESSION_TTL_MS);
  return token;
}
function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (m) return m[1].trim();
  // navigator.sendBeacon() cannot set headers -> allow ?token= for the unload beacon only
  const qi = (req.url || "").indexOf("?");
  if (qi >= 0) {
    const t = new URLSearchParams(req.url.slice(qi + 1)).get("token");
    if (t) return t.trim();
  }
  return null;
}
function userFromReq(req) {
  const tok = bearer(req);
  if (!tok) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE token = ?").get(tok);
  if (!s || s.expires_at < nowMs()) return null;
  return db.prepare("SELECT * FROM users WHERE id = ?").get(s.user_id) || null;
}
function sessionInfo(u, token) {
  return { token, id: u.id, email: u.email || null, isGuest: !!u.is_guest };
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let raw = "", size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_STATE_BYTES) { reject(new Error("payload too large")); req.destroy(); return; }
      raw += c;
    });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8"
};
function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url.split("?")[0] || "/"));
  if (rel === "/" || rel === "") rel = "/index.html";
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback -> index.html
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (e2, idx) => {
        if (e2) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(idx);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    headers["Cache-Control"] = (ext === ".html" || ext === ".webmanifest") ? "no-cache" : "public, max-age=3600";
    res.writeHead(200, headers);
    res.end(data);
  });
}

/* ---------------- routes ---------------- */
const server = http.createServer(async (req, res) => {
  const url = (req.url || "/").split("?")[0];
  const method = req.method || "GET";
  try {
    if (url === "/api/health") return sendJSON(res, 200, { ok: true, ts: nowMs() });

    if (url === "/api/auth/register" && method === "POST") {
      const { email, password } = await readJSON(req);
      const e = String(email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(e)) return sendJSON(res, 400, { error: "Неверный email" });
      if (!password || String(password).length < 6) return sendJSON(res, 400, { error: "Пароль минимум 6 символов" });
      if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(e)) return sendJSON(res, 409, { error: "Этот email уже занят" });
      const id = createUser(e, password, 0);
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      return sendJSON(res, 200, sessionInfo(u, createSession(id)));
    }

    if (url === "/api/auth/login" && method === "POST") {
      const { email, password } = await readJSON(req);
      const e = String(email || "").trim().toLowerCase();
      const u = db.prepare("SELECT * FROM users WHERE email = ?").get(e);
      if (!u || !u.pass_hash || !timingSafeEq(hashPw(password || "", u.salt), u.pass_hash))
        return sendJSON(res, 401, { error: "Неверный email или пароль" });
      return sendJSON(res, 200, sessionInfo(u, createSession(u.id)));
    }

    if (url === "/api/auth/guest" && method === "POST") {
      const id = createUser(null, null, 1);
      const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      return sendJSON(res, 200, sessionInfo(u, createSession(id)));
    }

    // --- everything below needs a valid session ---
    if (url.startsWith("/api/")) {
      const user = userFromReq(req);
      if (!user) return sendJSON(res, 401, { error: "Не авторизован" });

      if (url === "/api/me" && method === "GET")
        return sendJSON(res, 200, { id: user.id, email: user.email || null, isGuest: !!user.is_guest });

      if (url === "/api/auth/logout" && method === "POST") {
        const tok = bearer(req);
        if (tok) db.prepare("DELETE FROM sessions WHERE token = ?").run(tok);
        return sendJSON(res, 200, { ok: true });
      }

      if (url === "/api/auth/upgrade" && method === "POST") {
        if (!user.is_guest) return sendJSON(res, 400, { error: "Аккаунт уже создан" });
        const { email, password } = await readJSON(req);
        const e = String(email || "").trim().toLowerCase();
        if (!EMAIL_RE.test(e)) return sendJSON(res, 400, { error: "Неверный email" });
        if (!password || String(password).length < 6) return sendJSON(res, 400, { error: "Пароль минимум 6 символов" });
        if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id <> ?").get(e, user.id))
          return sendJSON(res, 409, { error: "Этот email уже занят" });
        const salt = crypto.randomBytes(16).toString("hex");
        db.prepare("UPDATE users SET email = ?, pass_hash = ?, salt = ?, is_guest = 0 WHERE id = ?")
          .run(e, hashPw(password, salt), salt, user.id);
        return sendJSON(res, 200, { email: e, isGuest: false });
      }

      if (url === "/api/state" && method === "GET") {
        const row = db.prepare("SELECT data, updated_at FROM states WHERE user_id = ?").get(user.id);
        let state = null;
        if (row) { try { state = JSON.parse(row.data); } catch (e) {} }
        return sendJSON(res, 200, { state, updatedAt: row ? row.updated_at : 0 });
      }

      if (url === "/api/state" && (method === "PUT" || method === "POST")) {
        const body = await readJSON(req);
        const state = body && body.state;
        if (!state || typeof state !== "object") return sendJSON(res, 400, { error: "bad state" });
        const t = nowMs();
        db.prepare(`INSERT INTO states(user_id, data, updated_at) VALUES(?,?,?)
                    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
          .run(user.id, JSON.stringify(state), t);
        return sendJSON(res, 200, { updatedAt: t });
      }

      if (url === "/api/state" && method === "DELETE") {
        db.prepare("DELETE FROM states WHERE user_id = ?").run(user.id);
        return sendJSON(res, 200, { ok: true });
      }

      return sendJSON(res, 404, { error: "not found" });
    }

    serveStatic(req, res);
  } catch (e) {
    console.error("[xaucore]", e && e.message);
    if (!res.headersSent) sendJSON(res, 500, { error: "server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`XAUCORE server listening on http://${HOST}:${PORT}`);
  console.log(`  static : ${PUBLIC_DIR}`);
  console.log(`  db     : ${DB_PATH}`);
});
