// M99 evidence miner (execution-sampled): exported pure functions at HEAD of the cloned permissive repos with typed
// number / string / boolean params and result. Examples = the upstream function run (empty vm context) on a fixed
// input grid; PeaceAI derives from a training slice plus the "prose" (the function's own doc comment and name only,
// never its body); the derived program is compared with upstream on the held-out grid and on the probes.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
const { deriveProgram, compileProgram, evalProgram, probeSet, farProbes } = await import("/workspace/w491/peaceai/lib/derive.ts");
// Harness only (input grid, like an issue author picking example inputs); the engine never sees the prose.
const describedConstants = (b: string) => { const s = new Set<number>(); for (const m of b.matchAll(/(?<![\w]|\d\.)\d{1,9}(?![\w]|\.\d)/g)) s.add(Number(m[0])); return { numbers: [...s].sort((a, c) => a - c) }; };
type V = number | string | boolean;
const roots = process.env.ROOTS ? process.env.ROOTS.split(",") : ["/workspace/mine/repos", "/workspace/mine88/repos"];
const DIRS = process.env.DIRS ? process.env.DIRS.split(",") : null;
const OUT = process.env.OUT ?? "/workspace/mine99e";
const CENSUS = !!process.env.DIRS;
const shard = Number(process.env.SHARD ?? 0), shards = Number(process.env.SHARDS ?? 1);
const dirs = DIRS ?? roots.flatMap((r) => execFileSync("ls", [r], { encoding: "utf8" }).trim().split("\n").map((d) => join(r, d)));
const out: any[] = []; const stats: Record<string, number> = {}; const bump = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
const seenRepo = new Set<string>();
const STR = ["", "a", "ab", "abc", "Hello", "x y", "hello world", "A-B", "foo.bar", "123", " pad "];
let n = 0;
for (const dir of dirs) {
  if (n++ % shards !== shard) continue;
  const repo = CENSUS ? "PeaceG03/PeaceSTOCKS" : dir.split("/").pop()!.replace("__", "/");
  if (seenRepo.has(repo) || (!CENSUS && /^PeaceG03\//.test(repo))) continue; seenRepo.add(repo);
  let tree: string[];
  try { tree = execFileSync("git", ["-C", dir, "ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean); } catch { continue; }
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const files = tree.filter((p) => /\.m?ts$/.test(p) && !/\.d\.ts$|\.(test|spec)\.|(^|\/)(node_modules|dist|test|tests|__tests__)\//.test(p)).slice(0, 4000);
  let perRepo = 0;
  for (const f of files) {
    if (perRepo >= 6 && !CENSUS) break;
    let src: string; try { src = execFileSync("git", ["-C", dir, "show", `HEAD:${f}`], { encoding: "utf8", maxBuffer: 1 << 26 }); } catch { continue; }
    if (src.length > 65536) continue;
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (!(ts.getModifiers(st as ts.HasModifiers) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      let fnNode: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined; let name = "";
      if (ts.isFunctionDeclaration(st) && st.name) { fnNode = st; name = st.name.text; }
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) { fnNode = d.initializer; name = d.name.text; }
      if (!fnNode || !fnNode.body || !fnNode.type || fnNode.typeParameters || (fnNode as any).asteriskToken || (ts.getModifiers(fnNode as any) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) continue;
      const ret = fnNode.type.getText(sf);
      if (!/^(number|string|boolean)$/.test(ret)) continue;
      const ps = fnNode.parameters.map((p) => ({ name: ts.isIdentifier(p.name) ? p.name.text : "", type: p.type?.getText(sf) ?? "", opt: !!(p.questionToken || p.initializer || p.dotDotDotToken) }));
      if (ps.length === 0 || ps.length > 3 || ps.some((p) => !p.name || p.opt || !/^(number|string|boolean)$/.test(p.type))) continue;
      if (ts.isBlock(fnNode.body) && fnNode.body.statements.length > 12) continue;
      bump("candidates");
      const text = st.getText(sf).replace(/^export\s+/, "");
      const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      const ctx = vm.createContext(Object.create(null));
      const up = (args: V[]): V | undefined => { try { return vm.runInContext(`(() => { ${js}\n; return ${name}(...${JSON.stringify(args)}); })()`, ctx, { timeout: 50 }) as V; } catch { return undefined; } };
      const lead = (ts.getLeadingCommentRanges(src, st.pos) ?? []).map((r) => src.slice(r.pos, r.end).replace(/^\/\*\*?|\*\/$|^\s*\*|^\/\//gm, " ")).join(" ").replace(/\s+/g, " ").trim();
      const prose = lead;
      const described = describedConstants(prose);
      // Input grid: small ints plus the integers the doc comment writes (and their neighbours).
      const nums = [...new Set([-1, 0, 1, 2, 3, 5, 10, 100, ...described.numbers.flatMap((d) => [d - 1, d, d + 1])])].sort((a, b) => a - b);
      const dom = (t: string): V[] => (t === "number" ? nums : t === "string" ? STR : [true, false]);
      let grid: V[][] = [[]];
      for (const p of ps) grid = grid.flatMap((g) => dom(p.type).map((v) => [...g, v]));
      if (grid.length > 3000) { // deterministic thinning
        const step = Math.ceil(grid.length / 3000); grid = grid.filter((_, i) => i % step === 0);
      }
      const rows: { args: V[]; out: V }[] = [];
      let bad = false;
      for (const a of grid) { const o = up(a); if (o === undefined || typeof o !== ret || (typeof o === "number" && !Number.isSafeInteger(o)) || (typeof o === "string" && (o.length > 120 || /["\\\u0000-\u001f]/.test(o)))) { bad = true; break; } rows.push({ args: a, out: o }); }
      if (bad || rows.length < 6) { bump("not_pure_int_or_runs"); continue; }
      if (new Set(rows.map((r) => JSON.stringify(r.out))).size < 2) { bump("constant_output"); continue; }
      // Training slice: every 3rd row (at most 14); held-out: the rest.
      const train = rows.filter((_, i) => i % 3 === 0).slice(0, 14);
      const held = rows.filter((r) => !train.includes(r));
      const params = ps.map((p) => ({ name: p.name, type: p.type as any }));
      const t0 = Date.now();
      const r = deriveProgram({ params, ret: ret as any, examples: train, budget: 1_500_000 });
      const ms = Date.now() - t0;
      const rec: any = { repo, head, file: f, fn: name, params: ps.map((p) => `${p.name}: ${p.type}`), ret, prose: prose.slice(0, 300), train: train.length, held: held.length, ms, upstream: text.slice(0, 500) };
      if (!r.ok) { rec.result = r.reason; rec.gate = (r as any).gate; rec.param = (r as any).param; rec.detail = String((r as any).detail ?? "").slice(0, 300); bump(`refuse_${r.reason}${(r as any).gate ? "_" + (r as any).gate : ""}`); out.push(rec); continue; }
      perRepo++;
      let right = 0, wrong = 0; const diffs: any[] = [];
      for (const h of held) { const d = evalProgram(r.fit.program, h.args); if (d === h.out) right++; else { wrong++; if (diffs.length < 3) diffs.push({ args: h.args, upstream: h.out, derived: d }); } }
      // Far probes (past every edge the training examples show), compared with upstream where upstream runs.
      let farRight = 0, farWrong = 0; const farDiffs: any[] = [];
      for (const a of farProbes(params, train)) { const o = up(a); if (o === undefined || typeof o !== ret) continue; const d = evalProgram(r.fit.program, a); if (d === o) farRight++; else { farWrong++; if (farDiffs.length < 3) farDiffs.push({ args: a, upstream: o, derived: d }); } }
      rec.farRight = farRight; rec.farWrong = farWrong; rec.farDiffs = farDiffs;
      if (farWrong) bump("ok_far_wrong");
      rec.result = "ok"; rec.expr = compileProgram(r.fit.program, ps.map((p) => p.name)); rec.heldRight = right; rec.heldWrong = wrong; rec.diffs = diffs;
      bump(wrong === 0 ? "ok_right" : "ok_wrong");
      out.push(rec);
    }
  }
}
writeFileSync(`${OUT}/out-${shard}.json`, JSON.stringify({ stats, out }, null, 1));
console.log(shard, JSON.stringify(stats));
