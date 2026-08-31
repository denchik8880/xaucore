/* =========================================================================
   XAUCORE — LOCAL dev server. NOT deployed.

   Vercel runs each file in api/ as its own serverless function and serves
   public/ statically. This script reproduces that locally on node:http so you
   can develop without the Vercel CLI: it mounts every handler under api/ at
   its route and serves public/ for everything else.

   Run:  npm run dev        (http://localhost:8777)
   DB:   uses file:./data/local.db unless TURSO_* env vars are set.
   ========================================================================= */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8777;
const PUBLIC_DIR = path.join(__dirname, "public");
const API_DIR = path.join(__dirname, "api");

// discover routes the same way Vercel does: file path -> URL path
const routes = new Map();
(function scan(dir, base = "/api") {
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    if (fs.statSync(fp).isDirectory()) {
      if (name !== "_lib") scan(fp, `${base}/${name}`);
      continue;
    }
    if (name.endsWith(".js")) routes.set(`${base}/${name.replace(/\.js$/, "")}`, fp);
  }
})(API_DIR);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon",
};

function decorate(req, res, u) {
  req.query = Object.fromEntries(u.searchParams);
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(o));
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  decorate(req, res, u);

  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    let raw = "";
    for await (const c of req) raw += c;
    const ct = req.headers["content-type"] || "";
    req.body = raw && ct.includes("json") ? safeParse(raw) : raw;
  }

  const key = u.pathname.replace(/\/+$/, "") || "/";

  if (key.startsWith("/api/")) {
    const file = routes.get(key);
    if (!file) return res.status(404).json({ error: "not found" });
    try {
      const mod = await import(pathToFileURL(file).href);
      await mod.default(req, res);
    } catch (e) {
      console.error("[api]", key, e);
      if (!res.headersSent) res.status(500).json({ error: String((e && e.message) || e) });
    }
    return;
  }

  // static (with SPA-style fallback to index.html)
  const rel = key === "/" ? "/index.html" : key;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const fp = path.join(PUBLIC_DIR, safe);
  if (fp.startsWith(PUBLIC_DIR) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.setHeader("Content-Type", MIME[path.extname(fp).toLowerCase()] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    fs.createReadStream(fp).pipe(res);
  } else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    fs.createReadStream(path.join(PUBLIC_DIR, "index.html")).pipe(res);
  }
});

function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }

server.listen(PORT, () => {
  console.log(`XAUCORE dev server  http://localhost:${PORT}`);
  console.log(`  routes : ${[...routes.keys()].sort().join(", ")}`);
  console.log(`  db     : ${process.env.TURSO_DATABASE_URL || "file:./data/local.db"}`);
});
