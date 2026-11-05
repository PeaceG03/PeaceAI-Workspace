// PeaceAI verifier-v1 judge (M204, batch 40). Spec: peaceai/spec/verifier-v1.md.
// The verdict is decided HERE, in a process of a THIRD uid (PEACEAI_VERIFIER_UID): neither the candidate uid that
// answered the calls nor the runner uid that relayed their raw stdout. This file never loads candidate code. It reads
// one JSON request on stdin ({ cases, runs, maxBytes, maxDepth }), compares with primordials captured at load, writes
// <outDir>/verdict.json (outDir owned by the verifier uid) and prints nothing else but "ok".
// Pure helpers are exported for verifier.ts and tests (one source of truth for parse and compare).
"use strict";
const P = Object.freeze({
  is: Object.is, isArray: Array.isArray, keys: Object.keys, parse: JSON.parse, stringify: JSON.stringify,
  isInteger: Number.isInteger, byteLength: Buffer.byteLength, RegExp, includes: String.prototype.includes,
  apply: Reflect.apply, test: RegExp.prototype.test,
});
const MAX_LINE_BYTES = 65_536;
const MAX_DEPTH = 32;
const WHERE = ["load", "lookup", "call", "await", "proto"];

/** Deep equality on JSON values with the judge's own primordials (identical key sets, Object.is on leaves). */
function valuesEqual(a, b, depth = 0) {
  if (depth > MAX_DEPTH) return false; // m202-guard:eq-depth
  if (P.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (P.isArray(a) !== P.isArray(b)) return false;
  if (P.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!valuesEqual(a[i], b[i], depth + 1)) return false;
    return true;
  }
  const ak = P.keys(a).sort(), bk = P.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) if (ak[i] !== bk[i]) return false;
  for (const k of ak) if (!valuesEqual(a[k], b[k], depth + 1)) return false;
  return true;
}

function jsonDepth(v, d = 0) {
  if (d > MAX_DEPTH) return d;
  if (v === null || typeof v !== "object") return d;
  let m = d;
  if (P.isArray(v)) for (const x of v) m = Math.max(m, jsonDepth(x, d + 1));
  else for (const k of P.keys(v)) m = Math.max(m, jsonDepth(v[k], d + 1));
  return m;
}

const isBool = (x) => x === true || x === false;
/** Parse one protocol response line. Fail-closed on any deviation. M204 fields are optional here (an old line still
 *  parses) but expectHolds credits nothing without them. Present with a wrong type: OOP_PROTOCOL. */
function parseResponse(line, maxBytes = MAX_LINE_BYTES, maxDepth = MAX_DEPTH) {
  if (typeof line !== "string") return { ok: false, code: "OOP_PROTOCOL", detail: "not-string" }; // m202-guard:proto-type
  if (P.byteLength(line, "utf8") > maxBytes) return { ok: false, code: "OOP_OVERSIZE", detail: "line" }; // m202-guard:oversize
  let obj;
  try { obj = P.parse(line); }
  catch { return { ok: false, code: "OOP_PROTOCOL", detail: "bad-json" }; } // m202-guard:proto-json
  if (!obj || typeof obj !== "object" || P.isArray(obj)) return { ok: false, code: "OOP_PROTOCOL", detail: "not-object" };
  if (obj.v !== 1) return { ok: false, code: "OOP_PROTOCOL", detail: "version" }; // m202-guard:proto-v
  if (typeof obj.id !== "number" || !P.isInteger(obj.id)) return { ok: false, code: "OOP_PROTOCOL", detail: "id" };
  if (typeof obj.ok !== "boolean") return { ok: false, code: "OOP_PROTOCOL", detail: "ok" };
  if (jsonDepth(obj) > maxDepth) return { ok: false, code: "OOP_DEPTH", detail: "response" }; // m202-guard:depth
  if (obj.ok === true) {
    if (!("value" in obj)) return { ok: false, code: "OOP_PROTOCOL", detail: "value" };
    if ("error" in obj) return { ok: false, code: "OOP_PROTOCOL", detail: "value-and-error" };
    if (("exact" in obj && !isBool(obj.exact)) || ("sync" in obj && !isBool(obj.sync))) return { ok: false, code: "OOP_PROTOCOL", detail: "flags" };
    const out = { ok: true, id: obj.id, resultOk: true, value: obj.value };
    if ("exact" in obj) out.exact = obj.exact;
    if ("sync" in obj) out.sync = obj.sync;
    return out;
  }
  const err = obj.error;
  if (!err || typeof err !== "object" || P.isArray(err)) return { ok: false, code: "OOP_PROTOCOL", detail: "error" };
  if (typeof err.name !== "string" || typeof err.message !== "string") return { ok: false, code: "OOP_PROTOCOL", detail: "error-fields" };
  if ("value" in obj) return { ok: false, code: "OOP_PROTOCOL", detail: "error-and-value" };
  if ("where" in obj && !WHERE.includes(obj.where)) return { ok: false, code: "OOP_PROTOCOL", detail: "where" };
  for (const k of ["obj", "nameStr", "msgStr", "trunc"]) if (k in err && !isBool(err[k])) return { ok: false, code: "OOP_PROTOCOL", detail: "error-flags" };
  if ("isa" in err && (!P.isArray(err.isa) || err.isa.length > 16 || err.isa.some((x) => typeof x !== "string"))) return { ok: false, code: "OOP_PROTOCOL", detail: "isa" };
  const error = { name: err.name, message: err.message };
  for (const k of ["obj", "nameStr", "msgStr", "trunc", "isa"]) if (k in err) error[k] = err[k];
  const out = { ok: true, id: obj.id, resultOk: false, error };
  if ("where" in obj) out.where = obj.where;
  return out;
}

const reOf = (m) => (m && typeof m === "object" && typeof m.re === "string" ? new P.RegExp(m.re, typeof m.flags === "string" ? m.flags : "") : null);

/** Does the parsed response satisfy the case's expectation? Each check is the exact semantics the extractor admitted
 *  (spec verifier-v1.md, M204 matcher table); anything the candidate did not report is NOT credited. */
function expectHolds(got, exp) {
  if (!exp || typeof exp !== "object") return false;
  if (exp.ok === true) {
    if (got.resultOk !== true || got.sync !== true) return false; // m204-guard:sync
    if (exp.any === true) return true; // doesNotThrow / not.toThrow: returned synchronously
    if (exp.negate === true) { // not.toBe / notStrictEqual, primitive literal only
      if (exp.value !== null && typeof exp.value === "object") return false; // m204-guard:negate-primitive
      return !(got.exact === true && P.is(got.value, exp.value));
    }
    if (got.exact !== true) return false; // m204-guard:exact
    if (exp.cmp === "is") return P.is(got.value, exp.value); // m204-guard:cmp-is
    return valuesEqual(got.value, exp.value); // m202-guard:expect-value
  }
  if (exp.ok !== false) return false;
  if (got.resultOk !== false || got.where !== "call") return false; // m204-guard:where-call
  const e = exp.error, g = got.error;
  if (!e) return true; // any synchronous throw
  if (e.isa !== undefined && !(P.isArray(g.isa) && g.isa.includes(e.isa))) return false; // m204-guard:isa
  if (e.name !== undefined && !(g.obj === true && g.nameStr === true && g.name === e.name)) return false; // m204-guard:err-name
  if (e.message !== undefined) {
    if (!(g.obj === true && g.msgStr === true && g.trunc !== true)) return false; // m204-guard:err-msg-str
    const re = reOf(e.message);
    if (re) { if (!P.apply(P.test, re, [g.message])) return false; }
    else if (typeof e.message !== "string" || g.message !== e.message) return false;
  }
  if (e.includes !== undefined) {
    if (!(g.obj === true && g.msgStr === true) || typeof e.includes !== "string") return false;
    if (!P.apply(P.includes, g.message, [e.includes])) return false;
  }
  return true;
}

/** Judge every case from the raw candidate runs the runner relayed. Returns the VerifyResult. */
function judge(req) {
  const maxBytes = req.maxBytes ?? MAX_LINE_BYTES, maxDepth = req.maxDepth ?? MAX_DEPTH;
  const results = [];
  const counts = () => ({ pass: results.filter((x) => x.pass).length, fail: results.filter((x) => !x.pass).length });
  for (let i = 0; i < req.runs.length; i++) {
    const c = req.cases[i], r = req.runs[i];
    if (!c || !r) return { code: "OOP_PROTOCOL", detail: "runs", results };
    if (r.timeout) return { code: "OOP_TIMEOUT", detail: r.session ? "session" : c.id, ...counts(), results };
    const lines = String(r.stdout ?? "").split("\n").filter((l) => l !== "");
    for (const line of lines) if (!line.trimStart().startsWith("{")) return { code: "OOP_STDOUT_NOISE", detail: c.id, results }; // m202-guard:noise
    if (lines.length !== 1) {
      if (lines.length === 0 && r.status !== 0) { results.push({ id: c.id, pass: false, reason: "exit:" + r.status }); continue; }
      return { code: "OOP_PROTOCOL", detail: `lines:${lines.length}`, results }; // m202-guard:one-line
    }
    const parsed = parseResponse(lines[0], maxBytes, maxDepth);
    if (!parsed.ok) return { code: parsed.code, detail: parsed.detail, results };
    if (parsed.id !== i + 1) return { code: "OOP_PROTOCOL", detail: "id-mismatch", results };
    if (expectHolds(parsed, c.expect)) { results.push({ id: c.id, pass: true }); continue; }
    const reason = parsed.resultOk ? (parsed.sync !== true ? "async" : parsed.exact !== true ? "inexact" : "value") : "error";
    // evidence (`got`) only when it is what the candidate returned: an inexact or async value's JSON copy is not
    results.push({ id: c.id, pass: false, reason,
      ...(reason === "value" ? { got: { ok: true, value: parsed.value } } : reason === "error" ? { got: { ok: false, name: String(parsed.error.name).slice(0, 80) } } : {}) });
  }
  if (req.runs.length !== req.cases.length) return { code: "OOP_PROTOCOL", detail: "runs", results };
  return { code: "OOP_OK", ...counts(), results, leftovers: 0 }; // m202-guard:ok
}

module.exports = { valuesEqual, parseResponse, expectHolds, judge, MAX_LINE_BYTES, MAX_DEPTH };

if (require.main === module) {
  const fs = require("node:fs");
  const path = require("node:path");
  const out = process.argv[2];
  if (!out || !path.isAbsolute(out)) { process.stderr.write("judge: out dir\n"); process.exit(2); }
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch { process.exit(3); }
  let verdict;
  try { verdict = judge(P.parse(raw)); } catch { verdict = { code: "OOP_PROTOCOL", detail: "judge-input" }; }
  fs.writeFileSync(path.join(out, "verdict.json"), P.stringify(verdict) + "\n", { mode: 0o644, flag: "wx" });
  process.stdout.write("ok\n");
}
