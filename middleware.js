/* =========================================================================
   XAUCORE — routing middleware. Runs on Vercel BEFORE routing / static files
   for every PAGE request (see `config.matcher`).

   This is the enforcement point for the "site closed" mode. Because it runs
   ahead of routing and the app is a single-page app (every "route" is just
   `/`), it can't be bypassed by deleting CSS, editing JS in DevTools,
   deep-linking an internal route, or pasting a URL — they all resolve to a
   page request and hit this gate first.

   The decision logic lives in api/_lib/gate.js so this file and dev-server.js
   behave identically. Node.js runtime -> it reuses the exact same crypto/DB
   code as the API routes (no separate Edge implementation to drift).

   Fail-open by design: the whole gate (import included) runs inside one
   try/catch, so if OWNER_KEY is unset, the DB is unreachable, or anything at
   all throws, the request passes straight through. The site cannot lock itself
   out and a bug here cannot take it down.
   ========================================================================= */

export const config = {
  runtime: "nodejs",
  // Pages (so a closed site shows the maintenance page) + the "sign in" API
  // routes (so a closed site can't be scripted into via new sessions).
  // Deliberately NOT matched: /api/state, /api/me, /api/health, /api/lock,
  // /api/owner and static assets — the state-sync path keeps zero overhead, and
  // those routes are already token- or owner-gated. Keep these exclusions in
  // sync with STATIC_SKIP + the "/api/" handling in api/_lib/gate.js.
  matcher: [
    "/",
    "/((?!api/|fonts/|wallet-bg|favicon\\.ico|manifest\\.webmanifest|_vercel/).*)",
    "/api/auth/:path*",
  ],
};

// Continue to routing / the origin. Vercel's middleware protocol — the same
// one-line helper as `@vercel/functions` `next()` / Next.js
// `NextResponse.next()`, inlined so this stays a zero-dependency file.
const pass = () => new Response(null, { headers: { "x-middleware-next": "1" } });

const NO_STORE = { "cache-control": "no-store", "retry-after": "3600" };

export default async function middleware(request) {
  try {
    const { gateDecision, MAINTENANCE_HTML } = await import("./api/_lib/gate.js");
    const { pathname } = new URL(request.url);
    const decision = await gateDecision({
      pathname,
      cookieHeader: request.headers.get("cookie") || "",
    });

    if (decision === "maintenance") {
      return new Response(MAINTENANCE_HTML, {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE },
      });
    }
    if (decision === "block-api") {
      return new Response(
        JSON.stringify({ error: "Сайт закрыт на техническое обслуживание" }),
        { status: 503, headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE } },
      );
    }
  } catch {
    // never take the site down over a gate error
  }
  return pass();
}
