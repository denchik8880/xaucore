import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// These tests never use the project's DB, credentials, network, or mail service.
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "xaucore-backend-"));
process.env.TURSO_DATABASE_URL = "file:" + path.join(temp, "test.db").replaceAll("\\", "/");
delete process.env.TURSO_AUTH_TOKEN;
process.env.RESEND_API_KEY = "test-only";
globalThis.fetch = async () => { throw new Error("Network disabled in backend tests"); };

const { db, ensureSchema } = await import("../api/_lib/db.js");
const { hashPw, newSalt } = await import("../api/_lib/auth.js");
const { default: state } = await import("../api/state.js");
const { default: hist } = await import("../api/hist.js");
const { default: reset } = await import("../api/auth/reset.js");
const { default: forgot } = await import("../api/auth/forgot.js");
const { default: register } = await import("../api/auth/register.js");
const { default: login } = await import("../api/auth/login.js");
const { isLocked, bustLockCache } = await import("../api/_lib/gate.js");
await ensureSchema();

after(async () => { db.close(); await fs.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }); });

async function fixture() {
  await db.batch(["DELETE FROM hist", "DELETE FROM states", "DELETE FROM sessions", "DELETE FROM pw_resets", "DELETE FROM users"], "write");
  const salt = newSalt();
  await db.execute({ sql: "INSERT INTO users(id,email,pass_hash,salt,is_guest,created_at) VALUES(?,?,?,?,0,?)", args: ["user", "test@example.invalid", hashPw("old-password", salt), salt, Date.now()] });
  await db.execute({ sql: "INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)", args: ["test-token", "user", Date.now(), Date.now() + 600000] });
}
async function call(handler, method, body, query = {}) {
  const result = { status: 0, body: null };
  const res = { setHeader() {}, status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await handler({ method, body, query, headers: { authorization: "Bearer test-token" } }, res);
  return result;
}
async function seedReset() {
  const salt = newSalt();
  await db.execute({ sql: "INSERT INTO pw_resets(email,user_id,code_hash,salt,expires_at,sent_at,tries) VALUES(?,?,?,?,?,?,0)", args: ["test@example.invalid", "user", hashPw("123456", salt), salt, Date.now() + 600000, Date.now()] });
}

test("only one concurrent device can claim a fresh or expired lease", async () => {
  for (const expired of [false, true]) {
    await fixture();
    if (expired) await db.execute({ sql: "INSERT INTO states(user_id,data,updated_at,lease_sid,lease_exp) VALUES(?,'null',0,'expired',0)", args: ["user"] });
    const results = await Promise.all(["a", "b", "c"].map(sid => call(state, "POST", { op: "claim", sid })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.equal(results.filter(r => r.status === 409).length, 2);
  }
});

test("a stale state write cannot take back a lease after forced takeover", async () => {
  await fixture();
  await call(state, "POST", { op: "claim", sid: "old" });
  const original = db.execute.bind(db);
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  let reached;
  const reachedWrite = new Promise(resolve => { reached = resolve; });
  db.execute = async (stmt, ...args) => {
    if (typeof stmt === "object" && /INSERT INTO states/.test(stmt.sql) && stmt.args.some(arg => typeof arg === "string" && arg.includes('"stale"'))) {
      reached(); await paused;
    }
    return original(stmt, ...args);
  };
  try {
    const pending = call(state, "PUT", { sid: "old", state: { marker: "stale" } });
    await reachedWrite;
    assert.equal((await call(state, "POST", { op: "claim", sid: "new", force: true })).status, 200);
    release();
    assert.equal((await pending).status, 409);
    assert.equal((await call(state, "GET", undefined, { sid: "new" })).body.lease.holder, "new");
  } finally { release(); db.execute = original; }
});

test("concurrent remote orders are retained once and the queue is capped at 50", async () => {
  await fixture();
  const results = await Promise.all(Array.from({ length: 60 }, (_, id) => call(state, "POST", { op: "order", sid: "follower", order: { kind: "buy", id } })));
  assert.equal(results.filter(r => r.status === 200).length, 50);
  assert.equal(results.filter(r => r.status === 429).length, 10);
  const drained = await call(state, "POST", { op: "live", sid: "driver", live: { price: 1 } });
  assert.equal(drained.status, 200);
  assert.equal(drained.body.ops.length, 50);
  assert.equal(new Set(drained.body.ops.map(op => op.id)).size, 50);
  assert.deepEqual((await call(state, "POST", { op: "live", sid: "driver" })).body.ops, []);
});

test("concurrent heartbeats and order submissions do not lose or duplicate orders", async () => {
  await fixture();
  await call(state, "POST", { op: "claim", sid: "driver" });
  const jobs = [];
  for (let id = 0; id < 30; id++) {
    jobs.push(call(state, "POST", { op: "order", order: { id } }));
    jobs.push(call(state, "POST", { op: "live", sid: "driver", live: { id } }));
  }
  const replies = await Promise.all(jobs);
  assert(replies.every(reply => reply.status === 200));
  const ops = replies.flatMap(reply => reply.body.ops || []);
  ops.push(...(await call(state, "POST", { op: "live", sid: "driver" })).body.ops);
  assert.equal(ops.length, 30);
  assert.equal(new Set(ops.map(op => op.id)).size, 30);
});

test("concurrent wrong reset codes cannot bypass the five-attempt limit", async () => {
  await fixture(); await seedReset();
  const replies = await Promise.all(Array.from({ length: 12 }, () => call(reset, "POST", { email: "test@example.invalid", code: "654321", password: "new-password" })));
  assert(replies.every(reply => reply.status === 400));
  assert.equal((await db.execute("SELECT * FROM pw_resets")).rows.length, 0);
  assert.deepEqual(replies.filter(reply => reply.body.left).map(reply => reply.body.left).sort(), [1, 2, 3, 4]);
});

test("a history upload rechecks the lease atomically and cannot prune after takeover", async () => {
  await fixture();
  await call(state, "POST", { op: "claim", sid: "old" });
  await call(hist, "PUT", { gen: "newgen", tf: "M1", k: 1, data: "keep", sid: "old" });
  const original = db.batch.bind(db);
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  let reached;
  const reachedWrite = new Promise(resolve => { reached = resolve; });
  db.batch = async (stmts, ...args) => {
    if (stmts.some(stmt => typeof stmt === "object" && /INSERT INTO hist/.test(stmt.sql))) { reached(); await paused; }
    return original(stmts, ...args);
  };
  try {
    const pending = call(hist, "PUT", { gen: "oldgen", tf: "M1", k: 0, data: "stale", sid: "old" });
    await reachedWrite;
    await call(state, "POST", { op: "claim", sid: "new", force: true });
    release();
    assert.equal((await pending).status, 409);
    assert.equal((await call(hist, "GET", undefined, { gen: "newgen", tf: "M1", k: "1" })).body.data, "keep");
  } finally { release(); db.batch = original; }
});

test("a reset transaction rolls back code, password and sessions if issuing its session fails", async () => {
  await fixture(); await seedReset();
  const before = (await db.execute("SELECT pass_hash, salt FROM users")).rows[0];
  await db.execute("CREATE TRIGGER fail_reset_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  try {
    await assert.rejects(call(reset, "POST", { email: "test@example.invalid", code: "123456", password: "new-password" }), /test rollback/);
    assert.equal((await db.execute("SELECT * FROM pw_resets")).rows.length, 1);
    assert.deepEqual({ ...(await db.execute("SELECT pass_hash, salt FROM users")).rows[0] }, { ...before });
    assert.equal((await db.execute("SELECT token FROM sessions")).rows[0].token, "test-token");
  } finally { await db.execute("DROP TRIGGER fail_reset_session"); }
});

test("a late previous-generation chunk cannot overwrite or prune the current history", async () => {
  await fixture();
  await call(state, "PUT", { sid: "driver", state: { hist: { gen: "newgen" } } });
  assert.equal((await call(hist, "PUT", { gen: "newgen", tf: "M1", k: 1, data: "keep", sid: "driver" })).status, 200);
  assert.equal((await call(hist, "PUT", { gen: "oldgen", tf: "M1", k: 0, data: "stale", sid: "driver" })).status, 409);
  assert.equal((await call(hist, "GET", undefined, { gen: "newgen", tf: "M1", k: "1" })).body.data, "keep");
  assert.equal((await call(hist, "GET", undefined, { gen: "oldgen", tf: "M1", k: "0" })).body.data, null);
  assert.equal((await call(hist, "PUT", { gen: "newgen", tf: "M1", k: 0, data: "current", sid: "driver" })).status, 200);
});

test("legacy states without history metadata can still upload chunks", async () => {
  await fixture();
  await call(state, "PUT", { sid: "driver", state: { legacy: true } });
  assert.equal((await call(hist, "PUT", { gen: "firstgen", tf: "M1", k: 0, data: "chunk", sid: "driver" })).status, 200);
});

test("a correct reset code is consumed once and old sessions are revoked atomically", async () => {
  await fixture(); await seedReset();
  const replies = await Promise.all(Array.from({ length: 3 }, (_, id) => call(reset, "POST", { email: "test@example.invalid", code: "123456", password: "new-password-" + id })));
  const successes = replies.filter(reply => reply.status === 200);
  assert.equal(successes.length, 1);
  const sessions = (await db.execute("SELECT token FROM sessions")).rows;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].token, successes[0].body.token);
  assert.equal((await db.execute("SELECT * FROM pw_resets")).rows.length, 0);
});

test("concurrent reset-code requests send only one letter per cooldown", async () => {
  await fixture();
  let sends = 0;
  globalThis.fetch = async () => { sends++; return { ok: true }; };
  try {
    const replies = await Promise.all(Array.from({ length: 3 }, () => call(forgot, "POST", { email: "test@example.invalid" })));
    assert.equal(replies.filter(reply => reply.status === 200).length, 1);
    assert.equal(replies.filter(reply => reply.status === 429).length, 2);
    assert.equal(sends, 1);
  } finally { globalThis.fetch = async () => { throw new Error("Network disabled in backend tests"); }; }
});

test("a slow failed letter cannot delete a newer successfully issued reset code", async () => {
  await fixture();
  const clock = Date.now;
  let failFirst, reachedFirst;
  const firstReached = new Promise(resolve => { reachedFirst = resolve; });
  let sends = 0;
  globalThis.fetch = async () => {
    if (++sends === 1) { reachedFirst(); return new Promise(resolve => { failFirst = () => resolve({ ok: false, status: 500, json: async () => ({}) }); }); }
    return { ok: true };
  };
  try {
    const first = call(forgot, "POST", { email: "test@example.invalid" });
    await firstReached;
    Date.now = () => clock() + 61000;
    assert.equal((await call(forgot, "POST", { email: "test@example.invalid" })).status, 200);
    const latest = (await db.execute("SELECT salt FROM pw_resets")).rows[0].salt;
    failFirst();
    assert.equal((await first).status, 502);
    assert.equal((await db.execute("SELECT salt FROM pw_resets")).rows[0].salt, latest);
  } finally { Date.now = clock; failFirst?.(); globalThis.fetch = async () => { throw new Error("Network disabled in backend tests"); }; }
});

test("concurrent registration of the same email returns a controlled conflict", async () => {
  await fixture();
  const replies = await Promise.all(Array.from({ length: 2 }, () => call(register, "POST", { email: "new@example.invalid", password: "new-password" })));
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]);
});

test("JSON null is rejected as input without crashing an auth route", async () => {
  await fixture();
  assert.equal((await call(login, "POST", "null")).status, 401);
});

test("the access gate cancels its DB timeout after a successful lookup", async () => {
  await fixture(); bustLockCache();
  const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const active = new Set();
  globalThis.setTimeout = (...args) => { const timer = set(...args); active.add(timer); return timer; };
  globalThis.clearTimeout = timer => { active.delete(timer); clear(timer); };
  try { assert.equal(await isLocked(), false); assert.equal(active.size, 0); }
  finally { for (const timer of active) clear(timer); globalThis.setTimeout = set; globalThis.clearTimeout = clear; }
});
