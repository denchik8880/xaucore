/* Small request/response helpers shared by every API route. */

export function json(res, code, obj) {
  res.setHeader("Cache-Control", "no-store");
  res.status(code).json(obj);
}

/** Method guard. Returns false (and sends 405) when the method is not allowed. */
export function allow(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader("Allow", methods.join(", "));
  json(res, 405, { error: "method not allowed" });
  return false;
}

/** Parse the JSON body whether Vercel pre-parsed it or we get a raw stream. */
export async function readJson(req) {
  const b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) return b;
  if (typeof b === "string") { try { return JSON.parse(b); } catch { return {}; } }
  if (Buffer.isBuffer(b)) { try { return JSON.parse(b.toString("utf8")); } catch { return {}; } }
  let raw = "";
  try { for await (const chunk of req) raw += chunk; } catch { /* ignore */ }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
