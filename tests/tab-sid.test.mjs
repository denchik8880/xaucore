import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";

// Exercise the implementation actually shipped in the application.
const source = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
const helperStart = source.indexOf("function xcNewTabSid(){");
const helperEnd = source.indexOf("const XC = {", helperStart);
const claimStart = source.indexOf("async function xcClaimLease(force){");
const claimEnd = source.indexOf("/* ---- the mirror frame ----", claimStart);
assert(helperStart >= 0 && helperEnd > helperStart, "Tab SID helper must exist in public/index.html");
assert(claimStart >= 0 && claimEnd > claimStart, "Lease claim helper must exist in public/index.html");
const helper = source.slice(helperStart, helperEnd);
const claim = source.slice(claimStart, claimEnd);
let ids = 0;

function locksBroker(){
  const held = new Map(), jobs = [];
  let paused = false;
  const schedule = job => paused ? jobs.push(job) : queueMicrotask(job);
  return {
    held,
    pause(){ paused = true; },
    flush(){ paused = false; for(const job of jobs.splice(0)) queueMicrotask(job); },
    destroy(owner){ for(const [name, value] of held) if(value === owner) held.delete(name); },
    for(owner){ return { request(name, options, callback){
      assert.equal(options.ifAvailable, true);
      assert.equal(options.mode, "exclusive");
      return new Promise((resolve, reject)=> schedule(()=>{
        const lock = held.has(name) ? null : { name };
        if(lock) held.set(name, owner);
        let result;
        try{ result = callback(lock); }catch(error){ reject(error); return; }
        Promise.resolve(result).then(value=>{
          if(lock && held.get(name) === owner) held.delete(name);
          resolve(value);
        }, reject);
      }));
    } }; },
  };
}

function document(broker, storage = new Map(), overrides = {}){
  const owner = "document-" + ++ids, requests = [];
  const context = vm.createContext({
    navigator: { locks: broker?.for(owner) },
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value)=>storage.set(key, value) },
    crypto: { randomUUID: ()=>"sid-" + ++ids },
    record: (token, method, path, body)=>{ requests.push({ token, method, path, body }); return { lease: { holder:body.sid } }; },
    ...overrides,
  });
  vm.runInContext(helper + `
    const XC = { sid:xcReadTabSid(), token:"token-old", _session:0, follower:true };
    function xcSession(){ return { token:XC.token, generation:XC._session }; }
    function xcSessionCurrent(s){ return s.token === XC.token && s.generation === XC._session; }
    async function xcApi(method,path,body){ return record(XC.token,method,path,body); }
    ` + claim + `
    globalThis.state = XC; globalThis.ensure = xcEnsureTabSid; globalThis.claim = xcClaimLease;
  `, context);
  return { owner, storage, requests, context, ensure:context.ensure, claim:context.claim, state:context.state };
}

test("ordinary tabs get distinct SIDs and retain their document locks", async ()=>{
  const broker = locksBroker(), a = document(broker), b = document(broker);
  assert.notEqual(await a.ensure(), await b.ensure());
  assert.equal(broker.held.size, 2);
  assert.equal(await a.claim(false), true);
  assert.equal(broker.held.size, 2);
});

test("a cloned sessionStorage cannot reuse an existing tab's SID", async ()=>{
  const broker = locksBroker(), a = document(broker);
  const original = await a.ensure();
  const b = document(broker, new Map(a.storage));
  assert.notEqual(await b.ensure(), original);
  assert.equal(a.state.sid, original);
  assert.equal(b.storage.get("xc_tab_sid"), b.state.sid);
});

test("simultaneously opened copied sessions reserve distinct SIDs", async ()=>{
  const broker = locksBroker();
  const a = document(broker, new Map([["xc_tab_sid", "copied"]]));
  const b = document(broker, new Map([["xc_tab_sid", "copied"]]));
  const values = await Promise.all([a.ensure(), b.ensure()]);
  assert.equal(new Set(values).size, 2);
  assert.equal(broker.held.size, 2);
});

test("reload reuses the session SID after the old document is destroyed", async ()=>{
  const broker = locksBroker(), old = document(broker);
  const sid = await old.ensure();
  broker.destroy(old.owner);
  const reloaded = document(broker, old.storage);
  assert.equal(await reloaded.ensure(), sid);
});

test("waiting for SID readiness cannot claim with a replacement account's token", async ()=>{
  const broker = locksBroker(); broker.pause();
  const page = document(broker);
  const pending = page.claim(false);
  page.state.token = "token-new"; page.state._session++;
  broker.flush();
  assert.equal(await pending, false);
  assert.equal(page.requests.length, 0);
  assert.equal(await page.claim(false), true);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].token, "token-new");
  assert.equal(page.requests[0].body.sid, page.state.sid);
});

test("without Web Locks every new document uses a fresh ID despite copied storage", async ()=>{
  const storage = new Map([["xc_tab_sid", "copied"]]);
  const a = document(null, storage), b = document(null, storage);
  const values = await Promise.all([a.ensure(), b.ensure()]);
  assert.equal(new Set(values).size, 2);
  assert(!values.includes("copied"));
});

test("Web Lock rejection falls back to a unique document ID", async ()=>{
  const storage = new Map([["xc_tab_sid", "copied"]]);
  const page = document(null, storage, { navigator:{ locks:{ request:()=>Promise.reject(new Error("unsupported")) } } });
  assert.notEqual(await page.ensure(), "copied");
  assert.equal(await page.claim(false), true);
});
