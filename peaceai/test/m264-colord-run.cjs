const { spawnSync } = require("child_process");
const { existsSync } = require("fs");
const { createRequire } = require("module");
const { resolve } = require("path");

const compiled = resolve("dist/tests/colord.test.js");
spawnSync(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "--pretty", "false",
  "--module", "commonjs",
  "--target", "ES2022",
  "--moduleResolution", "node",
  "--skipLibCheck",
  "--esModuleInterop",
  "--outDir", "dist",
  "--rootDir", ".",
  "src/index.ts",
  "tests/colord.test.ts",
  "tests/fixtures.ts",
], { stdio: "inherit" });
if (!existsSync(compiled)) process.exit(1);

const jobs = [];
function it(_name, fn) { jobs.push(fn); }
it.each = (cases) => (_name, fn) => {
  for (const item of cases) {
    const args = Array.isArray(item) ? item : [item];
    jobs.push(() => fn(...args));
  }
};
global.it = it;

function eq(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => eq(a[k], b[k]));
}
function subset(actual, expected) {
  if (expected === actual) return true;
  if (typeof expected !== "object" || !expected || typeof actual !== "object" || !actual) return Object.is(actual, expected);
  return Object.keys(expected).every((k) => subset(actual[k], expected[k]));
}
global.expect = (actual) => ({
  toBe(e) { if (!Object.is(actual, e)) throw new Error("toBe " + actual + " !== " + e); },
  toEqual(e) { if (!eq(actual, e)) throw new Error("toEqual"); },
  toMatchObject(e) { if (!subset(actual, e)) throw new Error("no match object " + JSON.stringify(actual).slice(0, 120)); },
  toBeUndefined() { if (actual !== undefined) throw new Error("not undefined"); },
  toBeInstanceOf(c) { if (!(actual instanceof c)) throw new Error("not instance"); },
  toMatch(re) {
    const s = String(actual);
    if (!(re instanceof RegExp ? re.test(s) : s.includes(String(re)))) throw new Error("no match");
  },
  get not() {
    return {
      toBe(e) { if (Object.is(actual, e)) throw new Error("was"); },
      toMatch(re) {
        const s = String(actual);
        if (re instanceof RegExp ? re.test(s) : s.includes(String(re))) throw new Error("did match");
      },
    };
  },
});

createRequire(__filename)(compiled);
let failed = 0;
for (const fn of jobs) {
  try { fn(); }
  catch (e) {
    failed++;
    process.stdout.write("Error: " + (e && e.stack ? e.stack : e) + "\n");
  }
}
if (failed) {
  process.stdout.write("Error: " + failed + " failed\n");
  process.exit(1);
}
