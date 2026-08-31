/* Create the database schema once. Safe to re-run (CREATE TABLE IF NOT EXISTS).
   Local:  npm run init-db
   Turso:  TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run init-db          */
import { db, ensureSchema } from "../api/_lib/db.js";

await ensureSchema();
const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
console.log("schema ready:", tables.rows.map((r) => r.name).join(", "));
process.exit(0);
