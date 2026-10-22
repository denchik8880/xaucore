import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test("local server survives an aborted request body and a malformed URL", { timeout: 15000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "xaucore-server-test-"));
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ["dev-server.js"], {
    cwd: root, windowsHide: true,
    env: { ...process.env, PORT: String(port), OWNER_KEY: "", TURSO_DATABASE_URL: "file:" + path.join(dir, "test.db").replaceAll("\\", "/"), TURSO_AUTH_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "", exited = false;
  child.stderr.on("data", chunk => { stderr += chunk; });
  const exit = new Promise(resolve => child.once("exit", () => { exited = true; resolve(); }));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Dev server startup timed out")), 8000);
      child.stdout.on("data", chunk => { if (String(chunk).includes("dev server")) { clearTimeout(timer); resolve(); } });
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Dev server exited during startup")); });
    });
    const socket = net.connect(port, "127.0.0.1");
    await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    socket.write("POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 99999\r\n\r\n{\"email\":");
    await pause(50);
    socket.destroy();
    await pause(100);
    assert.equal(exited, false, "An aborted body must not terminate the server");

    const malformed = net.connect(port, "127.0.0.1");
    let response = "";
    malformed.setEncoding("utf8");
    malformed.on("data", chunk => { response += chunk; });
    await new Promise((resolve, reject) => {
      malformed.once("connect", () => malformed.end("GET //% HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
      malformed.once("end", resolve); malformed.once("error", reject);
    });
    assert.match(response, /^HTTP\/1\.1 400/);
    assert.equal(exited, false, "A malformed URL must not terminate the server");

    const status = await new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: "/api/missing-test-route", agent: false }, res => { res.resume(); resolve(res.statusCode); }).once("error", reject);
    });
    assert.equal(status, 404);
    assert.doesNotMatch(stderr, /ECONNRESET|triggerUncaughtException/);
  } finally {
    if (!exited) child.kill();
    await exit;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});
