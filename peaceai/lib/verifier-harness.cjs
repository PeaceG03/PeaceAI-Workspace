// PeaceAI verifier-v1 candidate harness (M202). Fixed script: the verifier starts this as the candidate uid.
// Protocol (stdin/stdout, one JSON object per line, version 1):
//   request:  {"v":1,"id":<int>,"fn":<string>,"args":<json-array>,"nonce":<32-hex>}
//   response: {"v":1,"id":<int>,"nonce":<32-hex>,"ok":true,"value":<json>,...} |
//             {"v":1,"id":<int>,"nonce":<32-hex>,"ok":false,"error":{...},...}
// M217: every reply echoes the runner-generated per-call nonce; the judge refuses a missing / wrong nonce,
// extra / duplicate / out-of-order / unparsed lines. Only protocol lines go to stdout.
// The candidate module path is argv[2]. No inspector / SIGUSR1 (caller passes --disable-sigusr1).
// M204 (batch 40): every reply also says how the call ended, so the judge credits only what the test's own matcher
// would: ok replies carry `exact` (the value is plain JSON data, so JSON carries it without loss: no undefined, NaN,
// Infinity, -0, class instance, null prototype, symbol key, accessor, hole or extra array key) and `sync` (returned
// without a promise); error replies carry `where` (load / lookup / call / await) and, in `error`, `obj` (an object was
// thrown), `nameStr` / `msgStr` (own-or-inherited name / message are strings), `trunc` (message cut at 2000) and `isa`
// (the builtin error classes it is an instance of). Primordials are captured before the candidate module loads.
// The pure helpers are exported (require.main !== module) for tests; the verifier copies this file and runs it.
"use strict";
const { pathToFileURL } = require("node:url");
const { createInterface } = require("node:readline");

const H = Object.freeze({
  getProto: Object.getPrototypeOf, ownKeys: Reflect.ownKeys, desc: Object.getOwnPropertyDescriptor,
  isArray: Array.isArray, isFinite: Number.isFinite, is: Object.is, ObjectProto: Object.prototype, ArrayProto: Array.prototype,
  stringify: JSON.stringify, parse: JSON.parse, String,
  errors: [["Error", Error], ["TypeError", TypeError], ["RangeError", RangeError], ["SyntaxError", SyntaxError],
    ["ReferenceError", ReferenceError], ["EvalError", EvalError], ["URIError", URIError]],
});
const EXACT_DEPTH = 32;
const NONCE_RE = /^[0-9a-f]{32}$/;

/** Runner-generated per-call nonce (M217): 32 lowercase hex chars. */
function validNonce(n) { return typeof n === "string" && NONCE_RE.test(n); }

/** True only for plain JSON data that JSON.stringify / JSON.parse carry without loss. */
function isExact(v, d = 0) {
  if (d > EXACT_DEPTH) return false;
  if (v === null) return true;
  const t = typeof v;
  if (t === "string" || t === "boolean") return true;
  if (t === "number") return H.isFinite(v) && !H.is(v, -0); // m204-guard:h-number
  if (t !== "object") return false; // undefined, bigint, symbol, function
  const keys = H.ownKeys(v);
  if (H.isArray(v)) {
    if (H.getProto(v) !== H.ArrayProto) return false; // m204-guard:h-array-proto
    const n = v.length;
    if (keys.length !== n + 1) return false; // holes, extra keys, symbols
    for (let i = 0; i < n; i++) {
      const ds = H.desc(v, H.String(i));
      if (!ds || !("value" in ds) || !ds.enumerable || !isExact(ds.value, d + 1)) return false;
    }
    return true;
  }
  if (H.getProto(v) !== H.ObjectProto) return false; // m204-guard:h-object-proto
  for (const k of keys) {
    if (typeof k !== "string") return false; // m204-guard:h-symbol
    const ds = H.desc(v, k);
    if (!ds || !("value" in ds) || !ds.enumerable || !isExact(ds.value, d + 1)) return false; // m204-guard:h-data-prop
  }
  return true;
}

/** The reply's value: the value itself when exact, else a best-effort JSON copy (evidence only, never credited). */
function replyValue(v) {
  if (isExact(v)) return { value: v, exact: true };
  let copy = null;
  try { const s = H.stringify(v); copy = s === undefined ? null : H.parse(s); } catch { copy = null; }
  return { value: copy, exact: false };
}

const modPath = require.main === module ? process.argv[2] : null;

let mod = null;
let loadErr = null;
if (modPath) {
  // Prefer CJS require for .cjs/.js without "type":"module"; fall back to dynamic import for ESM.
  try { mod = require(modPath); }
  catch (e1) { loadErr = e1; } // defer to async import below
}

function serializeErr(e) {
  const obj = e !== null && (typeof e === "object" || typeof e === "function");
  let rawName, rawMsg;
  try { rawName = obj ? e.name : undefined; } catch { rawName = undefined; }
  try { rawMsg = obj ? e.message : undefined; } catch { rawMsg = undefined; }
  const nameStr = typeof rawName === "string", msgStr = typeof rawMsg === "string";
  const name = nameStr ? rawName.slice(0, 200) : "Error";
  let full;
  if (msgStr) full = rawMsg; else { try { full = H.String(e); } catch { full = ""; } }
  const isa = [];
  if (obj) for (const [n, C] of H.errors) { try { if (e instanceof C) isa.push(n); } catch { /* */ } }
  let trunc = false;
  if (full.length > 2000) trunc = true; // m204-guard:h-trunc
  return { name, message: full.slice(0, 2000), obj, nameStr, msgStr, trunc, isa };
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function ensureMod() {
  if (mod !== null) return;
  try {
    const loaded = await import(pathToFileURL(modPath).href);
    // ESM namespace: prefer .default if it looks like the exports object, else the namespace itself.
    // M204: the module's own named exports win over same-named properties of a default object (as `import { f }`).
    mod = loaded && typeof loaded === "object" && loaded.default && typeof loaded.default === "object" && !Array.isArray(loaded.default)
      ? { ...loaded.default, ...loaded }
      : loaded;
    loadErr = null;
  } catch (e) {
    loadErr = e;
  }
}

async function handle(line) {
  let req;
  try { req = JSON.parse(line); }
  catch { reply({ v: 1, id: -1, ok: false, where: "proto", error: { name: "ProtocolError", message: "bad-json" } }); return; }
  if (!req || req.v !== 1 || typeof req.id !== "number" || !Number.isInteger(req.id) || typeof req.fn !== "string" || !Array.isArray(req.args) || !validNonce(req.nonce)) {
    reply({ v: 1, id: typeof req?.id === "number" ? req.id : -1, ...(validNonce(req?.nonce) ? { nonce: req.nonce } : {}), ok: false, where: "proto", error: { name: "ProtocolError", message: "bad-request" } });
    return;
  }
  const nonce = req.nonce;
  await ensureMod();
  if (loadErr || mod === null) {
    reply({ v: 1, id: req.id, nonce, ok: false, where: "load", error: serializeErr(loadErr || new Error("load-failed")) });
    return;
  }
  const fn = mod[req.fn];
  if (typeof fn !== "function") {
    reply({ v: 1, id: req.id, nonce, ok: false, where: "lookup", error: { name: "TypeError", message: "not-a-function:" + req.fn.slice(0, 100), obj: true, nameStr: true, msgStr: true, trunc: false, isa: ["Error", "TypeError"] } });
    return;
  }
  // M204: a bare `f(x)` in the test has no receiver; `ns.f(x)` has the module as receiver (req.recv === "module").
  const recv = req.recv === "module" ? mod : undefined;
  let out;
  try { out = fn.apply(recv, req.args); }
  catch (e) { reply({ v: 1, id: req.id, nonce, ok: false, where: "call", error: serializeErr(e) }); return; }
  let thenable = false;
  try { thenable = out !== null && (typeof out === "object" || typeof out === "function") && typeof out.then === "function"; } catch { thenable = false; }
  let value = out, sync = true;
  if (thenable) {
    sync = false; // m204-guard:h-async
    try { value = await out; }
    catch (e) { reply({ v: 1, id: req.id, nonce, ok: false, where: "await", error: serializeErr(e) }); return; }
  }
  reply({ v: 1, id: req.id, nonce, ok: true, ...replyValue(value), sync });
}

module.exports = { isExact, replyValue, serializeErr, validNonce };
if (require.main === module) (async () => {
  if (!modPath || typeof modPath !== "string") {
    process.stderr.write("harness: missing module path\n");
    process.exit(2);
  }
  await ensureMod();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line === "") continue;
    await handle(line);
  }
})().catch((e) => {
  try { process.stderr.write(String(e && e.stack || e) + "\n"); } catch { /* ignore */ }
  process.exit(1);
});
