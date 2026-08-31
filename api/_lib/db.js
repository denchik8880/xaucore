/* =========================================================================
   XAUCORE — database layer (Turso / libSQL).

   Prod (Vercel, read-only FS): set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.
   Local dev: falls back to a local SQLite file (file:./data/local.db) so you
   can run without a Turso account. Same libSQL client either way.
   ========================================================================= */
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const url = process.env.TURSO_DATABASE_URL || "file:./data/local.db";
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

// a local file: url needs its directory to exist (never hit on Vercel/Turso)
if (url.startsWith("file:")) {
  const file = url.slice("file:".length).replace(/^\/+/, "");
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* ignore */ }
}

export const db = createClient({ url, authToken, intMode: "number" });

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users(
     id         TEXT PRIMARY KEY,
     email      TEXT UNIQUE,
     pass_hash  TEXT,
     salt       TEXT,
     is_guest   INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions(
     token      TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS states(
     user_id    TEXT PRIMARY KEY,
     data       TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
];

let schemaReady = null;
/** Create tables on first use. Cached for the life of the (warm) instance. */
export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const sql of SCHEMA) await db.execute(sql);
    })().catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}
