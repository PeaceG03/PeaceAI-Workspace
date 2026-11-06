// EXPERIMENTAL learn step 2: a skill tree of what the default planner cannot yet change in a program.
// credit is always false. Not wired into scoring, grading, or results.
// "Could I change this?" is asked of the default planner (plandefault.ts → plan-only-v4's planTaskV4).
// A gap is a leaf only when it touches one function or fewer and has one concrete test idea.
// Otherwise it is split by function, then by behavior, down to depth 5. What is still too big is
// marked TOO_BIG_UNSPLIT and kept — never dropped.
import ts from "typescript";
import { openRepo, type CodeRepo } from "./codesearch.ts";
import { DEFAULT_PLANNER, PLANNERS } from "./plandefault.ts";
import { planTaskV4 } from "./plan4.ts";
import { approvedRules, type Capability, type PlanContext } from "./plan.ts";
import { loadModel } from "./nlparse.ts";
import type { IndexFile } from "./symbols.ts";
import { buildProgramMap, type ProgramMap, type ProgramModule } from "./learnmap.ts";

export const LEARN_TREE_SCHEMA = "peaceai-learn-skill-tree:v1" as const;
export const MAX_GAP_DEPTH = 5;
const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface GapNode {
  id: string;
  title: string;
  parent: string | null;
  children: string[];
  size: "leaf" | "split" | "TOO_BIG_UNSPLIT";
  testIdea: string | null;
  /** Set only for TOO_BIG_UNSPLIT. */
  reason: string | null;
  depth: number;
  /** Behavior slots this node accounts for. A split's units equal the sum of its children. */
  units: number;
}
export interface SkillTree {
  schema: typeof LEARN_TREE_SCHEMA;
  experimental: true;
  credit: false;
  /** The planner plandefault.ts currently selects. */
  planner: typeof DEFAULT_PLANNER;
  /** Approved-rule ids the planner marked can-do for a module it was asked about. */
  doable: string[];
  /** Capabilities the planner reported missing (its own vocabulary, not a new one). */
  missing: string[];
  nodes: GapNode[];
}

type Piece = { kind: "ret"; text: string } | { kind: "if"; cond: string; then: Piece[]; else: Piece[] };
interface FnFact { name: string; line: number; pieces: Piece[] }
interface Spec {
  id: string;
  title: string;
  parent: string | null;
  depth: number;
  path: string;
  fns: FnFact[];
  pieces: Piece[];
  stack: string[];
  units: number;
  idea: string | null;
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function unitCount(ps: Piece[]): number {
  let n = 0;
  for (const p of ps) n += p.kind === "ret" ? 1 : unitCount(p.then) + unitCount(p.else);
  return n;
}

function asStmts(n: ts.Statement): ts.Statement[] {
  return ts.isBlock(n) ? [...n.statements] : [n];
}

function piecesFromStmts(stmts: readonly ts.Statement[], sf: ts.SourceFile): Piece[] {
  const out: Piece[] = [];
  for (const st of stmts) {
    if (ts.isIfStatement(st)) {
      out.push({
        kind: "if",
        cond: st.expression.getText(sf).replace(/\s+/g, " ").trim(),
        then: piecesFromStmts(asStmts(st.thenStatement), sf),
        else: st.elseStatement ? piecesFromStmts(asStmts(st.elseStatement), sf) : [],
      });
      continue;
    }
    if (ts.isReturnStatement(st)) {
      out.push({ kind: "ret", text: st.getText(sf).replace(/\s+/g, " ").replace(/;$/, "").trim() });
      continue;
    }
    if (ts.isBlock(st)) { out.push(...piecesFromStmts([...st.statements], sf)); continue; }
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) continue;
    // A statement that hides returns (try, switch, loop) still counts those returns as behaviors.
    const nested: ts.Statement[] = [];
    const visit = (n: ts.Node): void => {
      if (n !== st && (ts.isReturnStatement(n) || ts.isIfStatement(n))) nested.push(n as ts.Statement);
      else ts.forEachChild(n, visit);
    };
    visit(st);
    if (nested.length) out.push(...piecesFromStmts(nested, sf));
  }
  return out;
}

function fnPieces(body: ts.ConciseBody | ts.Block | undefined, sf: ts.SourceFile): Piece[] {
  if (!body) return [];
  if (ts.isBlock(body)) return piecesFromStmts([...body.statements], sf);
  return [{ kind: "ret", text: `return ${body.getText(sf).replace(/\s+/g, " ").trim()}` }];
}

/** Module-scope functions, function-valued consts, and class methods, in source order. */
function functionsIn(path: string, content: string): FnFact[] {
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const fns: FnFact[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) fns.push({ name: st.name.text, line: lineOf(sf, st), pieces: fnPieces(st.body, sf) });
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) {
          fns.push({ name: d.name.text, line: lineOf(sf, d), pieces: fnPieces(d.initializer.body, sf) });
        }
      }
    } else if (ts.isClassDeclaration(st) && st.name) {
      for (const m of st.members) {
        if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name)) {
          fns.push({ name: `${st.name.text}.${m.name.text}`, line: lineOf(sf, m), pieces: fnPieces(m.body, sf) });
        }
      }
    }
  }
  return fns;
}

function fnUnits(fn: FnFact): number {
  const n = unitCount(fn.pieces);
  return n === 0 ? 1 : n;
}

function singleReturn(ps: Piece[]): string | null {
  if (ps.length === 1 && ps[0]!.kind === "ret") return ps[0]!.text;
  return null;
}

function ideaFor(fn: string | null, stack: string[], pieces: Piece[], path: string, exports: readonly string[]): string {
  const when = stack.length ? ` when ${stack.join(" and ")}` : "";
  if (fn) {
    const ret = singleReturn(pieces);
    return ret ? `call ${fn}${when} and assert ${ret}` : `call ${fn}${when} and assert its return value`;
  }
  return exports.length ? `assert ${path} still exports ${exports.join(", ")}` : `assert ${path} still loads`;
}

function readWhole(code: CodeRepo, path: string): string | null {
  let start = 1;
  let out = "";
  for (let guard = 0; guard < 100; guard++) {
    const r = code.read(path, { start, end: start + 1999 });
    if (!r.ok) return out ? out : null;
    out = out ? `${out}\n${r.text}` : r.text;
    if (!r.truncated) return out;
    start = r.endLine + 1;
  }
  return out;
}

interface Arm { pieces: Piece[]; cond: string | null; tag: string }

function splitPieces(ps: Piece[]): Arm[] | null {
  if (ps.length >= 2) return ps.map((p, i) => ({ pieces: [p], cond: null, tag: `s${i}` }));
  if (ps.length === 1 && ps[0]!.kind === "if") {
    const iff = ps[0]!;
    const out: Arm[] = [];
    if (unitCount(iff.then) > 0) out.push({ pieces: iff.then, cond: iff.cond, tag: "t" });
    if (unitCount(iff.else) > 0) out.push({ pieces: iff.else, cond: iff.cond, tag: "e" });
    if (out.length >= 2) return out;
  }
  return null;
}

function isLeaf(spec: Spec): boolean {
  return spec.fns.length <= 1 && spec.units <= 1 && !!spec.idea;
}

function childrenOf(spec: Spec): Spec[] | null {
  if (spec.fns.length > 1) {
    return spec.fns.map((fn) => {
      const pieces = fn.pieces;
      const units = fnUnits(fn);
      return {
        id: `fn:${spec.path}:${fn.name}`,
        title: `fix ${fn.name} in ${spec.path}`,
        parent: spec.id,
        depth: spec.depth + 1,
        path: spec.path,
        fns: [fn],
        pieces,
        stack: [],
        units,
        idea: ideaFor(fn.name, [], pieces, spec.path, []),
      };
    });
  }
  if (spec.fns.length === 1) {
    const fn = spec.fns[0]!;
    const arms = splitPieces(spec.pieces);
    if (!arms || arms.length < 2) return null;
    return arms.map((arm) => {
      const stack = arm.cond === null ? spec.stack : [...spec.stack, arm.tag === "e" ? `not (${arm.cond})` : arm.cond];
      const units = unitCount(arm.pieces) || 1;
      const tag = spec.id.startsWith("beh:") ? `${spec.id.slice(spec.id.lastIndexOf(":") + 1)}.${arm.tag}` : arm.tag;
      return {
        id: `beh:${spec.path}:${fn.name}:${tag}`,
        title: stack.length ? `fix ${fn.name} when ${stack.join(" and ")}` : `fix ${fn.name} in ${spec.path}`,
        parent: spec.id,
        depth: spec.depth + 1,
        path: spec.path,
        fns: [fn],
        pieces: arm.pieces,
        stack,
        units,
        idea: ideaFor(fn.name, stack, arm.pieces, spec.path, []),
      };
    });
  }
  return null;
}

function expand(spec: Spec, out: GapNode[]): void {
  const base = { id: spec.id, title: spec.title, parent: spec.parent, depth: spec.depth, units: spec.units };
  if (!isLeaf(spec) && spec.depth >= MAX_GAP_DEPTH) {
    out.push({ ...base, children: [], size: "TOO_BIG_UNSPLIT", testIdea: null, reason: `still ${spec.units} behaviors at depth ${MAX_GAP_DEPTH}` });
    return;
  }
  const kids = isLeaf(spec) ? null : childrenOf(spec);
  if (!kids || kids.length < 2) {
    if (isLeaf(spec)) {
      out.push({ ...base, children: [], size: "leaf", testIdea: spec.idea, reason: null });
      return;
    }
    // Cannot divide, and it is not a single testable behavior. Keep it; only call it TOO_BIG at the depth cap.
    const atCap = spec.depth >= MAX_GAP_DEPTH;
    out.push({
      ...base, children: [], size: atCap ? "TOO_BIG_UNSPLIT" : "leaf",
      testIdea: atCap ? null : (spec.idea ?? `call ${spec.fns[0]?.name ?? spec.path} and assert its return value`),
      reason: atCap ? `unsplittable with ${spec.units} behaviors at depth ${spec.depth}` : null,
    });
    return;
  }
  // Parent units follow the children so a split never drops or invents a slot.
  const sum = kids.reduce((s, k) => s + k.units, 0);
  out.push({ ...base, units: sum, children: kids.map((k) => k.id), size: "split", testIdea: null, reason: null });
  for (const kid of kids) expand(kid, out);
}

function moduleSpec(mod: ProgramModule, content: string, missing: string): Spec {
  const fns = functionsIn(mod.path, content);
  const pieces = fns.length === 1 ? fns[0]!.pieces : [];
  const units = fns.length === 0 ? 1 : fns.reduce((s, fn) => s + fnUnits(fn), 0);
  const idea = fns.length <= 1 && units <= 1 ? ideaFor(fns[0]?.name ?? null, [], pieces, mod.path, mod.exports) : null;
  return {
    id: `mod:${mod.path}`,
    title: `fix ${mod.path} — missing ${missing}`,
    parent: null,
    depth: 0,
    path: mod.path,
    fns,
    pieces,
    stack: [],
    units,
    idea,
  };
}

function anchorOf(mod: ProgramModule, content: string): string {
  const fn = functionsIn(mod.path, content)[0];
  if (fn && /^[A-Za-z_$][\w$]*$/.test(fn.name)) return fn.name;
  const exp = mod.exports.find((n) => /^[A-Za-z_$][\w$]*$/.test(n));
  if (exp) return exp;
  return mod.path.slice(mod.path.lastIndexOf("/") + 1).replace(/\.[cm]?[jt]sx?$/, "");
}

/**
 * Asks the default planner, once per module, whether it could change that module.
 * A module is a gap unless an edit-source step for that exact file is can-do.
 */
export function buildSkillTree(map: ProgramMap, repoPath: string): SkillTree {
  if (PLANNERS[DEFAULT_PLANNER].run !== "runFileV4") throw new Error("refused PLANNER_UNSUPPORTED");
  const code = openRepo(repoPath);
  const tree = code.tree();
  const files: IndexFile[] = [];
  if (tree.ok) {
    for (const p of tree.files) {
      if (!/\.[cm]?[jt]sx?$/.test(p)) continue;
      const content = readWhole(code, p);
      if (content !== null) files.push({ path: p, content });
    }
  }
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const ctx: PlanContext = { repo: "learn-target", files, rules: approvedRules(), model: loadModel(), testCommand: null };
  const doable = new Set<string>();
  const missing = new Set<Capability>();
  const nodes: GapNode[] = [];
  for (const mod of map.modules) {
    const content = byPath.get(mod.path) ?? "";
    const anchor = anchorOf(mod, content);
    const request = `fix \`${anchor}\``;
    const plan = planTaskV4(`learn-${mod.path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40)}`, request, ctx, code);
    const own = plan.steps.filter((s) => s.file === mod.path && s.action === "edit-source");
    if (own.some((s) => s.status === "can-do")) {
      for (const s of own) if (s.status === "can-do" && s.rule) doable.add(s.rule.split("@")[0]!);
      continue;
    }
    for (const cap of plan.missingSkills) missing.add(cap);
    const cap = own.find((s) => s.missing)?.missing ?? plan.missingSkills[0] ?? "edit-existing-function";
    expand(moduleSpec(mod, content, cap), nodes);
  }
  nodes.sort((a, b) => byStr(a.id, b.id));
  return {
    schema: LEARN_TREE_SCHEMA,
    experimental: true,
    credit: false,
    planner: DEFAULT_PLANNER,
    doable: [...doable].sort(byStr),
    missing: [...missing].sort(byStr),
    nodes,
  };
}

/** Plain-text outline a person can read. */
export function renderSkillTree(tree: SkillTree): string {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const lines = [`EXPERIMENTAL credit=false planner=${tree.planner}`];
  const walk = (id: string, depth: number) => {
    const n = byId.get(id);
    if (!n) return;
    const extra = n.testIdea ? ` :: ${n.testIdea}` : n.reason ? ` :: ${n.reason}` : "";
    lines.push(`${"  ".repeat(depth)}- [${n.size}] ${n.title}${extra}`);
    for (const c of n.children) walk(c, depth + 1);
  };
  for (const n of tree.nodes) if (n.parent === null) walk(n.id, 0);
  return `${lines.join("\n")}\n`;
}

/** True when every gap is kept: split units match their children, and nothing sits past depth 5. */
export function treeConserved(tree: SkillTree): boolean {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  if (byId.size !== tree.nodes.length || tree.nodes.length === 0) return false;
  let rootUnits = 0;
  let termUnits = 0;
  for (const n of tree.nodes) {
    if (n.depth > MAX_GAP_DEPTH || n.units < 1) return false;
    if (n.parent === null) rootUnits += n.units;
    else if (byId.get(n.parent)?.children.includes(n.id) !== true) return false;
    if (n.size === "split") {
      if (n.children.length < 2 || n.depth >= MAX_GAP_DEPTH || n.testIdea !== null) return false;
      let sum = 0;
      for (const id of n.children) {
        const kid = byId.get(id);
        if (!kid || kid.parent !== n.id) return false;
        sum += kid.units;
      }
      if (sum !== n.units) return false;
    } else {
      if (n.children.length !== 0) return false;
      if (n.size === "leaf" && !n.testIdea) return false;
      if (n.size === "TOO_BIG_UNSPLIT" && (n.depth !== MAX_GAP_DEPTH || !n.reason)) return false;
      termUnits += n.units;
    }
  }
  return rootUnits === termUnits;
}

/** Map plus tree. `buildProgramMap` is re-exported so a caller can learn a repo in one step. */
export function learnRepo(repoPath: string): { map: ProgramMap; tree: SkillTree; outline: string } {
  const map = buildProgramMap(repoPath);
  const tree = buildSkillTree(map, repoPath);
  return { map, tree, outline: renderSkillTree(tree) };
}
