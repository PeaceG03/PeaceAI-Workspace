// PeaceAI verifier-v1 candidate harness (M202). Fixed script: the verifier starts this as the candidate uid.
// Protocol (stdin/stdout, one JSON object per line, version 1):
//   request:  {"v":1,"id":<int>,"fn":<string>,"args":<json-array>}
//   response: {"v":1,"id":<int>,"ok":true,"value":<json>} | {"v":1,"id":<int>,"ok":false,"error":{"name":<string>,"message":<string>}}
// Only protocol lines go to stdout. Anything else is a protocol deviation the verifier refuses.
// The candidate module path is argv[2]. No inspector / SIGUSR1 (caller passes --disable-sigusr1).
"use strict";
const { pathToFileURL } = require("node:url");
const { createInterface } = require("node:readline");

const modPath = process.argv[2];
if (!modPath || typeof modPath !== "string") {
  process.stderr.write("harness: missing module path\n");
  process.exit(2);
}

let mod = null;
let loadErr = null;
try {
  // Prefer CJS require for .cjs/.js without "type":"module"; fall back to dynamic import for ESM.
  try { mod = require(modPath); }
  catch (e1) {
    // defer to async import below
    loadErr = e1;
  }
} catch (e) { loadErr = e; }

function serializeErr(e) {
  const name = e && typeof e === "object" && typeof e.name === "string" ? e.name.slice(0, 200) : "Error";
  const message = e && typeof e === "object" && typeof e.message === "string" ? e.message.slice(0, 2000) : String(e).slice(0, 2000);
  return { name, message };
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function ensureMod() {
  if (mod !== null) return;
  try {
    const loaded = await import(pathToFileURL(modPath).href);
    // ESM namespace: prefer .default if it looks like the exports object, else the namespace itself.
    mod = loaded && typeof loaded === "object" && loaded.default && typeof loaded.default === "object" && !Array.isArray(loaded.default)
      ? { ...loaded, ...loaded.default }
      : loaded;
    loadErr = null;
  } catch (e) {
    loadErr = e;
  }
}

async function handle(line) {
  let req;
  try { req = JSON.parse(line); }
  catch { reply({ v: 1, id: -1, ok: false, error: { name: "ProtocolError", message: "bad-json" } }); return; }
  if (!req || req.v !== 1 || typeof req.id !== "number" || !Number.isInteger(req.id) || typeof req.fn !== "string" || !Array.isArray(req.args)) {
    reply({ v: 1, id: typeof req?.id === "number" ? req.id : -1, ok: false, error: { name: "ProtocolError", message: "bad-request" } });
    return;
  }
  await ensureMod();
  if (loadErr || mod === null) {
    reply({ v: 1, id: req.id, ok: false, error: serializeErr(loadErr || new Error("load-failed")) });
    return;
  }
  const fn = mod[req.fn];
  if (typeof fn !== "function") {
    reply({ v: 1, id: req.id, ok: false, error: { name: "TypeError", message: "not-a-function:" + req.fn.slice(0, 100) } });
    return;
  }
  try {
    const out = fn.apply(mod, req.args);
    if (out && typeof out.then === "function") {
      try {
        const value = await out;
        reply({ v: 1, id: req.id, ok: true, value });
      } catch (e) {
        reply({ v: 1, id: req.id, ok: false, error: serializeErr(e) });
      }
    } else {
      reply({ v: 1, id: req.id, ok: true, value: out });
    }
  } catch (e) {
    reply({ v: 1, id: req.id, ok: false, error: serializeErr(e) });
  }
}

(async () => {
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
