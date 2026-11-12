// Grader-owned behavioral check. credit: false.
// The solver never calls this. After a candidate has already passed the given test and the original
// suite, this loads that symbol and the fix's copy of the same symbol in separate sandboxes and
// compares them on the test's concrete arguments plus general mutations of those arguments.
// A constant that only matches the thin test comes back verified_test_only. A symbol that cannot be
// imported on its own comes back diff_unavailable and is never treated as strict.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { runInPracticeSandbox } from "./practicemine.ts";
import type { CallForm } from "./testspec.ts";

export const INPUT_CAP = 50;
export const BEHAVIORS = ["verified_strict", "verified_test_only", "diff_unavailable"] as const;
export type Behavior = (typeof BEHAVIORS)[number];

export interface BehaviorTarget {
  symbol: string;
  file: string;
  form: CallForm;
  exportName: string;
  prop?: string;
  args: unknown[][];
}

export interface BehaviorCounterexample {
  args: string;
  candidate: string;
  fix: string;
}

export interface BehaviorGrade {
  behavior: Behavior;
  compared: number;
  counterexample?: BehaviorCounterexample;
}

interface ParamFlags { nulls: boolean; undef: boolean }

const PROBE = `
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const spec = JSON.parse(readFileSync(process.argv[2], "utf8"));
const untag = (v) => {
  if (!v || typeof v !== "object" || !("k" in v)) return v;
  if (v.k === "nan") return NaN;
  if (v.k === "undef") return undefined;
  if (v.k === "null") return null;
  if (v.k === "a") return v.v.map(untag);
  if (v.k === "o") { const o = {}; for (const [key, val] of Object.entries(v.v)) o[key] = untag(val); return o; }
  return v.v;
};
const pack = (value) => {
  if (typeof value === "undefined") return { k: "undef" };
  if (typeof value === "number" && Number.isNaN(value)) return { k: "nan" };
  if (value === null) return { k: "null" };
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return { k: "v", v: value };
  if (Array.isArray(value)) return { k: "a", v: value.map(pack) };
  if (typeof value === "object") { const o = {}; for (const [key, val] of Object.entries(value)) o[key] = pack(val); return { k: "o", v: o }; }
  return { k: "other" };
};
let mod;
try { mod = await import(pathToFileURL(spec.file).href); }
catch { console.log(JSON.stringify({ load: "error" })); process.exit(0); }
let fn = spec.form === "default" || spec.form === "default-prop" ? mod.default : mod[spec.exportName];
if (spec.form === "default-prop" || spec.form === "named-prop") fn = fn?.[spec.prop];
if (typeof fn !== "function") { console.log(JSON.stringify({ load: "not-a-function" })); process.exit(0); }
const results = [];
for (const args of spec.inputs) {
  const values = args.map(untag);
  try { results.push({ thrown: false, value: pack(fn(...values)) }); }
  catch { results.push({ thrown: true }); }
}
console.log(JSON.stringify({ load: "ok", results }));
`;

function tag(value: unknown): unknown {
  if (typeof value === "undefined") return { k: "undef" };
  if (typeof value === "number" && Number.isNaN(value)) return { k: "nan" };
  if (value === null) return { k: "null" };
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return { k: "v", v: value };
  if (Array.isArray(value)) return { k: "a", v: value.map(tag) };
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = tag(item);
    return { k: "o", v: out };
  }
  return { k: "other" };
}

function seedOf(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const swap = out[i]!;
    out[i] = out[j]!;
    out[j] = swap;
  }
  return out;
}

function keyOf(args: unknown[]): string {
  return JSON.stringify(args.map(tag));
}

function mutants(value: unknown, flags: ParamFlags | undefined): unknown[] {
  const out: unknown[] = [];
  if (typeof value === "number" && Number.isFinite(value)) out.push(value + 1, value - 1, 0, value === 0 ? -1 : -Math.abs(value), Number.NaN);
  else if (typeof value === "string") {
    const flipped = [...value].map((ch) => ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()).join("");
    out.push("", flipped, `${value}x`);
    if (value.length > 0) out.push(value.slice(0, -1));
  } else if (Array.isArray(value)) {
    out.push([]);
    if (value.length > 0) out.push([value[0]]);
  } else if (typeof value === "boolean") out.push(!value);
  if (flags?.nulls) out.push(null);
  if (flags?.undef) out.push(undefined);
  return out;
}

function paramFlags(source: string, symbol: string): ParamFlags[] {
  const sf = ts.createSourceFile("candidate.ts", source, ts.ScriptTarget.Latest, true);
  const flagsOf = (params: readonly ts.ParameterDeclaration[]): ParamFlags[] => params.map((param) => {
    const text = param.type ? param.type.getText(sf).replace(/\s+/g, "") : "";
    const loose = text === "any" || text === "unknown";
    return { nulls: loose || text.split("|").includes("null"), undef: Boolean(param.questionToken) || loose || text.split("|").includes("undefined") };
  });
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === symbol) return flagsOf(st.parameters);
    if (ts.isVariableStatement(st)) for (const decl of st.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== symbol || !decl.initializer) continue;
      const init = decl.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return flagsOf(init.parameters);
    }
  }
  return [];
}

/** The test's own argument lists, then seeded mutations, capped at INPUT_CAP. */
export function behaviorInputs(examples: readonly (readonly unknown[])[], flags: readonly ParamFlags[], seedText: string): unknown[][] {
  const originals: unknown[][] = [];
  const seen = new Set<string>();
  const add = (bucket: unknown[][], args: unknown[]) => {
    const key = keyOf(args);
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(args);
  };
  for (const example of examples) add(originals, [...example]);
  const varied: unknown[][] = [];
  for (const example of originals) {
    example.forEach((value, index) => {
      for (const next of mutants(value, flags[index])) {
        const args = [...example];
        args[index] = next;
        add(varied, args);
      }
    });
  }
  const ordered = [...originals, ...shuffle(varied, seedOf(seedText))];
  return ordered.slice(0, INPUT_CAP);
}

function parseProbe(stdout: string): { load: string; results?: { thrown: boolean; value?: unknown }[] } | null {
  const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]!) as { load: string; results?: { thrown: boolean; value?: unknown }[] }; } catch { /* keep looking */ }
  }
  return null;
}

function show(value: unknown): string {
  try { return JSON.stringify(value); } catch { return "\"unserializable\""; }
}

function sanitize(text: string, roots: readonly string[]): string {
  let out = text;
  for (const root of roots) out = out.split(root).join("<work>");
  return out.replace(/\/(?:tmp|home|opt|usr|var|exec-daemon|Users)\/[^\s'")]+/g, "<path>").slice(0, 240);
}

function loadSide(root: string, file: string, target: BehaviorTarget, inputs: unknown[][], nodePath: string, nodeModules: string | null): { load: string; results?: { thrown: boolean; value?: unknown }[] } | null {
  const probe = join(root, ".practice-behavior.mjs");
  const spec = join(root, ".practice-behavior.json");
  try {
    writeFileSync(probe, PROBE);
    writeFileSync(spec, JSON.stringify({
      file: join(root, file),
      form: target.form,
      exportName: target.exportName,
      prop: target.prop ?? "",
      inputs: inputs.map((args) => args.map(tag)),
    }));
    const ran = runInPracticeSandbox(root, [nodePath, "--experimental-strip-types", probe, spec], 20_000, { capture: true, nodePath, nodeModules });
    if (ran.unsafe || ran.code === null) return null;
    return parseProbe(ran.stdout);
  } finally {
    rmSync(probe, { force: true });
    rmSync(spec, { force: true });
  }
}

/**
 * Compare the candidate symbol with the fix's symbol. Neither tree is modified except for a probe
 * file that is removed before this returns. A load failure is diff_unavailable.
 */
export function gradeBehavior(input: {
  candidateRoot: string;
  fixRoot: string;
  target: BehaviorTarget;
  nodePath: string;
  nodeModules?: string | null;
}): BehaviorGrade {
  let source = "";
  try { source = readFileSync(join(input.candidateRoot, input.target.file), "utf8"); } catch { source = ""; }
  const flags = paramFlags(source, input.target.form === "named" ? input.target.exportName : input.target.symbol);
  const inputs = behaviorInputs(input.target.args, flags, `${input.target.symbol}\0${input.target.file}\0${JSON.stringify(input.target.args.map(tag))}`);
  if (!inputs.length) return { behavior: "diff_unavailable", compared: 0 };
  const modules = input.nodeModules ?? null;
  const candidate = loadSide(input.candidateRoot, input.target.file, input.target, inputs, input.nodePath, modules);
  const fix = loadSide(input.fixRoot, input.target.file, input.target, inputs, input.nodePath, modules);
  if (!candidate || candidate.load !== "ok" || !candidate.results || !fix || fix.load !== "ok" || !fix.results) return { behavior: "diff_unavailable", compared: 0 };
  if (candidate.results.length !== inputs.length || fix.results.length !== inputs.length) return { behavior: "diff_unavailable", compared: 0 };
  for (let i = 0; i < inputs.length; i++) {
    const left = candidate.results[i]!;
    const right = fix.results[i]!;
    const same = left.thrown === right.thrown && (left.thrown || JSON.stringify(left.value) === JSON.stringify(right.value));
    if (same) continue;
    const roots = [input.candidateRoot, input.fixRoot];
    return {
      behavior: "verified_test_only",
      compared: inputs.length,
      counterexample: {
        args: sanitize(show(inputs[i]), roots),
        candidate: sanitize(left.thrown ? "thrown" : show(left.value), roots),
        fix: sanitize(right.thrown ? "thrown" : show(right.value), roots),
      },
    };
  }
  return { behavior: "verified_strict", compared: inputs.length };
}
