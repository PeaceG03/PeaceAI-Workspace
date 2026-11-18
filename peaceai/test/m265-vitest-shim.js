
import { readFileSync, writeSync } from "node:fs";
function eq(a, b, seen = new WeakMap()) {
  if (Object.is(a, b)) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a instanceof Error && b instanceof Error) return a.name === b.name && a.message === b.message;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    if (seen.get(a) === b) return true;
    seen.set(a, b);
    return a.every((v, i) => eq(v, b[i], seen));
  }
  if (a instanceof Map && b instanceof Map && a.size === b.size) {
    for (const [k, v] of b) if (!eq(a.get(k), v, seen)) return false;
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (seen.get(a) === b) return true;
    seen.set(a, b);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!eq(a[k], b[k], seen)) return false;
    }
    return true;
  }
  return false;
}
function subset(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (expected instanceof RegExp) return expected.test(actual);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((v, i) => subset(actual[i], v));
  }
  if (expected instanceof Map) {
    if (!(actual instanceof Map)) return false;
    for (const [k, v] of expected) if (!subset(actual.get(k), v)) return false;
    return true;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    for (const k of Object.keys(expected)) if (!subset(actual[k], expected[k])) return false;
    return true;
  }
  return eq(actual, expected);
}
function track(impl) {
  const wrapped = function (...args) {
    wrapped.mock.calls.push(args);
    return impl ? impl.apply(this, args) : undefined;
  };
  wrapped.mock = { calls: [] };
  return wrapped;
}
const jobs = [];
const stack = [[]];
const afters = [[]];
const beforeAlls = [];
const afterAlls = [];
function describe(_n, fn) { const local = []; const late = []; stack.push(local); afters.push(late); fn(); stack.pop(); afters.pop(); }
let currentTitle = "";
function test(n, fn) {
  const setup = stack.flat();
  const cleanup = afters.flat();
  const title = [...names, n].join(" > ");
  jobs.push(async () => { currentTitle = title; for (const b of setup) await b(); try { await fn(); } finally { for (const a of cleanup) await a(); } });
}
test.skipIf = (cond) => (name, fn) => { if (!cond) test(name, fn); };
function beforeEach(fn) { stack[stack.length - 1].push(fn); }
function afterEach(fn) { afters[afters.length - 1].push(fn); }
function beforeAll(fn) { beforeAlls.push(fn); }
function afterAll(fn) { afterAlls.push(fn); }
function each(register) {
  return (cases) => (name, fn) => {
    for (const item of cases) {
      const args = Array.isArray(item) ? item : [item];
      let i = 0;
      const title = String(name).replace(/%[sdj]/g, () => String(args[i++]));
      register(title, () => fn(...args));
    }
  };
}
describe.each = each(describe);
const it = test;
it.each = each(it);
test.each = each(test);
const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const realClearTimeout = globalThis.clearTimeout.bind(globalThis);
let fake = null;
const vi = {
  fn(impl) { return track(impl); },
  useFakeTimers() {
    fake = { now: 0, next: 1, timers: [] };
    globalThis.setTimeout = (fn, delay, ...args) => {
      const id = fake.next++;
      fake.timers.push({ id, fn, due: fake.now + Number(delay || 0), args });
      return id;
    };
    globalThis.clearTimeout = (id) => { fake.timers = fake.timers.filter((t) => t.id !== id); };
  },
  useRealTimers() {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    fake = null;
  },
  advanceTimersByTime(ms) {
    const target = fake.now + ms;
    for (;;) {
      const due = fake.timers.filter((t) => t.due <= target).sort((a, b) => a.due - b.due);
      if (!due.length) break;
      const timer = due[0];
      fake.now = timer.due;
      fake.timers = fake.timers.filter((t) => t !== timer);
      timer.fn(...timer.args);
    }
    fake.now = target;
  },
  getTimerCount() { return fake ? fake.timers.length : 0; },
  spyOn(obj, method) {
    const orig = obj[method];
    const wrapped = (...args) => { wrapped.mock.calls.push(args); return orig.apply(obj, args); };
    wrapped.mock = { calls: [] };
    wrapped.mockRestore = () => { obj[method] = orig; };
    obj[method] = wrapped;
    return wrapped;
  },
};
function expect(actual) {
  const calls = () => actual && actual.mock ? actual.mock.calls : [];
  const api = {
    toBe(e) { if (!Object.is(actual, e)) throw new Error("toBe " + JSON.stringify(actual) + " !== " + JSON.stringify(e)); },
    toEqual(e) { if (!eq(actual, e)) throw new Error("toEqual " + JSON.stringify(actual) + " vs " + JSON.stringify(e)); },
    toStrictEqual(e) { if (!eq(actual, e)) throw new Error("strict " + JSON.stringify(actual) + " vs " + JSON.stringify(e)); },
    toBeNull() { if (actual !== null) throw new Error("not null"); },
    toBeUndefined() { if (actual !== undefined) throw new Error("not undefined"); },
    toContain(e) {
      const ok = typeof actual === "string" ? actual.includes(e) : Array.isArray(actual) && actual.includes(e);
      if (!ok) throw new Error("not contain " + e);
    },
    toBeTruthy() { if (!actual) throw new Error("not truthy"); },
    toBeFalsy() { if (actual) throw new Error("not falsy"); },
    toHaveLength(n) { if (!actual || actual.length !== n) throw new Error("length " + (actual && actual.length)); },
    toBeLessThan(n) { if (!(actual < n)) throw new Error("not <"); },
    toBeLessThanOrEqual(n) { if (!(actual <= n)) throw new Error("not <="); },
    toBeInstanceOf(c) { if (!(actual instanceof c)) throw new Error("not instance"); },
    toHaveProperty(k, v) {
      const parts = String(k).split(".");
      let cur = actual;
      for (const p of parts) cur = cur?.[p];
      if (arguments.length === 1) { if (cur === undefined) throw new Error("missing " + k); }
      else if (!eq(cur, v)) throw new Error("prop " + k);
    },
    toMatch(re) {
      const s = String(actual);
      if (re instanceof RegExp) { if (!re.test(s)) throw new Error("no match " + s); }
      else if (!s.includes(String(re))) throw new Error("no match " + s);
    },
    toMatchObject(e) { if (!subset(actual, e)) throw new Error("no match object " + JSON.stringify(actual).slice(0,180)); },
    toThrow(e) {
      let threw = false, err;
      try { actual(); } catch (ex) { threw = true; err = ex; }
      if (!threw) throw new Error("expected throw");
      if (e instanceof RegExp && !e.test(err.message)) throw new Error("throw mismatch " + err.message);
    },
    toHaveBeenCalled() { if (!calls().length) throw new Error("not called"); },
    toHaveBeenCalledTimes(n) { if (calls().length !== n) throw new Error("times " + calls().length); },
    toHaveBeenCalledWith(...args) { if (!calls().some((c) => eq(c, args))) throw new Error("not with"); },
    toHaveBeenNthCalledWith(n, ...args) { if (!eq(calls()[n - 1], args)) throw new Error("nth"); },
    toHaveBeenLastCalledWith(...args) { if (!eq(calls()[calls().length - 1], args)) throw new Error("last"); },
    get rejects() {
      return {
        async toThrow(e) {
          let err;
          try { await actual; }
          catch (ex) { err = ex; }
          if (!err) throw new Error("expected reject");
          if (e instanceof RegExp && !e.test(String(err.message || err))) throw new Error("reject mismatch " + err.message);
          if (typeof e === "string" && !String(err.message || err).includes(e)) throw new Error("reject mismatch " + err.message);
        },
      };
    },
    get not() {
      return {
        toBe(e) { if (Object.is(actual, e)) throw new Error("was " + e); },
        toEqual(e) { if (eq(actual, e)) throw new Error("was equal"); },
        toContain(e) {
          const ok = typeof actual === "string" ? actual.includes(e) : Array.isArray(actual) && actual.includes(e);
          if (ok) throw new Error("did contain");
        },
        toBeInstanceOf(c) { if (actual instanceof c) throw new Error("was instance"); },
        toThrow() { try { actual(); } catch { throw new Error("did throw"); } },
        toHaveBeenCalled() { if (calls().length) throw new Error("was called"); },
      };
    },
  };
  return api;
}
globalThis.describe = describe;
globalThis.it = it;
globalThis.test = test;
globalThis.beforeEach = beforeEach;
globalThis.expect = expect;
globalThis.vi = vi;
globalThis.afterEach = afterEach;
globalThis.beforeAll = beforeAll;
globalThis.afterAll = afterAll;
export { describe, it, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll };

const names = [];
const snapCounts = new Map();
const origDescribe = describe;
describe = function (n, fn) { names.push(n); origDescribe(n, fn); names.pop(); };
describe.each = each(describe);
globalThis.describe = describe;
function loadSnaps() {
  let text = "";
  try { text = readFileSync("src/__snapshots__/Tokenizer.spec.ts.snap", "utf8"); }
  catch { return new Map(); }
  const map = new Map();
  let i = 0;
  while (true) {
    const start = text.indexOf("exports[`", i);
    if (start < 0) break;
    const keyStart = start + "exports[`".length;
    const keyEnd = text.indexOf("`] = `", keyStart);
    const key = text.slice(keyStart, keyEnd);
    const valStart = keyEnd + "`] = `".length;
    const valEnd = text.indexOf("`;", valStart);
    map.set(key, Function(`"use strict"; return (${text.slice(valStart, valEnd)});`)());
    i = valEnd + 2;
  }
  return map;
}
const snaps = loadSnaps();
const origExpect = expect;
expect = function (actual) {
  const api = origExpect(actual);
  api.toMatchSnapshot = () => {
    const title = currentTitle;
    const n = (snapCounts.get(title) ?? 0) + 1;
    snapCounts.set(title, n);
    const key = `${title} ${n}`;
    const expected = snaps.get(key);
    if (expected === undefined) throw new Error("missing snapshot " + key);
    if (!eq(actual, expected)) throw new Error("snapshot mismatch " + key + " " + JSON.stringify(actual).slice(0,120));
  };
  return api;
};
globalThis.expect = expect;
queueMicrotask(async () => {
  let failed = 0;
  try { for (const fn of beforeAlls) await fn(); }
  catch (e) { failed++; writeSync(1, "FAIL " + (e && e.stack ? e.stack : e) + "\n"); }
  for (const fn of jobs) {
    try { await fn(); }
    catch (e) { failed++; writeSync(1, "FAIL " + (e && e.stack ? e.stack : e) + "\n"); }
  }
  try { for (const fn of afterAlls) await fn(); }
  catch (e) { failed++; writeSync(1, "FAIL " + (e && e.stack ? e.stack : e) + "\n"); }
  if (failed) { writeSync(1, "Error: " + failed + " failed\n"); process.exit(1); }
});
