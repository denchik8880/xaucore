/* =========================================================================
   XAUCORE — tiny server-side key/value store (Turso `settings` table).

   Used for runtime flags that must be toggleable WITHOUT a redeploy — right
   now just the "site closed" switch (`site_locked`). Separate from per-user
   `states`: nothing here touches a user's simulator state.
   ========================================================================= */
import { db, ensureSchema } from "./db.js";

export async function getSetting(key) {
  await ensureSchema();
  const r = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [key] });
  return r.rows[0] ? r.rows[0].value : null;
}

export async function setSetting(key, value) {
  await ensureSchema();
  await db.execute({
    sql: `INSERT INTO settings(key, value) VALUES(?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, String(value)],
  });
}
