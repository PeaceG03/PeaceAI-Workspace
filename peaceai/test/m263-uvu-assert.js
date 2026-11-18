function deep(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deep(a[k], b[k]));
}
function fail(msg) { const e = new Error(msg); e.name = "Assertion"; throw e; }
export function ok(v, msg) { if (!v) fail(msg || "expected truthy"); }
export function is(a, b, msg) { if (!Object.is(a, b)) fail(msg || "not identical"); }
export function equal(a, b, msg) { if (!deep(a, b)) fail((msg || "not equal") + " " + JSON.stringify(a) + " vs " + JSON.stringify(b)); }
export function type(v, t) { if (typeof v !== t) fail("type " + typeof v + " !== " + t); }
export function instance(v, ctor) { if (!(v instanceof ctor)) fail("not instance"); }
export function unreachable() { fail("unreachable"); }
