// M156: the hash-only handoff of the hidden task-set near-dup check (lb-clean --matched-out / --drop-hashes). Auditor
// runs --report-only --matched-out against the hidden refs and keeps the hash file; we commit it as
// peaceai/model/lb-hidden-drop-hashes.txt (add-only) and clean with --drop-hashes. Covered here: the round trip
// (report-only + matched-out -> clean with drop-hashes -> report-only gives 0), every refusal with near misses, the
// fingerprint over the drop files, stdout carrying counts only (no doc text, path or name), the add-only guard of the
// committed file, and mutants of every bin guard (m156-guard:<id>) and every add-only guard line (guard:<id>).
// Rule-level cases and lib mutants are in m150. Synthetic code only; no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import * as L from "../lib/lbclean.ts";
import { dropLogAddOnlyProblem } from "./m156-droplog.ts";
import { failingDropLogCases } from "./m156-droplog-cases.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const tsx = join(repo, "node_modules", ".bin", "tsx");
const BIN = join(repo, "peaceai/bin/lb-clean.ts");
const DROP_FILE = "peaceai/model/lb-hidden-drop-hashes.txt";
const SYN = "SynthOwner/Synth-Repo";
const EXTXT = `# public half\nunjs/defu\n# hidden half (hashes)\nsha256:${H(SYN.toLowerCase())}\n`;
const NAMES = ["secret-checkout-m156", "hiddendirm156", "hiddenfilem156"]; // hidden-tree names: never printed
const block = (p: string, n = 40) => Array.from({ length: n }, (_, i) => `export const ${p}V${i} = ${p}Compute${i}(${p}Alpha${i}, ${p}Beta${i}) + ${i * 7};`).join("\n") + "\n";
const fn = (name: string, k: number, body = 8) => `/** ${name} returns a value for ${k}. */\nexport function ${name}(a: number, b: number): number {\n` + Array.from({ length: body }, (_, i) => `  const ${name}T${i} = a * ${k + i} + b - ${i};\n  if (${name}T${i} > ${k * 3 + i}) { return ${name}T${i} - ${k}; }\n`).join("") + `  return [a, b].reduce((s, x) => s + x, ${k});\n}\n`;
const CFG = JSON.parse(readFileSync(join(repo, "peaceai/model/lb-clean.json"), "utf8")) as L.LbConfig;

type Run = { status: number | null; stdout: string; stderr: string };
/** The CLI scenarios, run against `bin` (the real bin or a relocated mutant). Returns the problems found (empty = all
 * pass). With `stop`, returns at the first problem (mutants). */
function scenarios(bin: string, dir: string, stop: boolean): string[] {
  const bad: string[] = [];
  const outs: string[] = [];
  const run = (...a: string[]): Run => { const r = spawnSync(tsx, [bin, ...a], { cwd: repo, encoding: "utf8" }); outs.push(r.stdout, r.stderr); return r; };
  const expect = (name: string, cond: () => boolean) => { if (stop && bad.length) return; try { if (!cond()) bad.push(name); } catch { bad.push(name); } };
  const refused = (name: string, code: string, ...a: string[]) => expect(name, () => { const r = run(...a); return r.status === 1 && r.stdout === `lb-clean refused: ${code}\n` && r.stderr === ""; });
  const corpus = (d: string, rows: { text: string; path: string; split?: string }[], repoName = "clean/a") => {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "docs.jsonl"), rows.map((r, i) => JSON.stringify({ doc: i, text: r.text }) + "\n").join(""));
    writeFileSync(join(d, "manifest.jsonl"), rows.map((r, i) => JSON.stringify({ doc: i, split: r.split ?? "train", repo: repoName, path: r.path, function: `f${i}` }) + "\n").join(""));
  };
  const lines = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean);
  const texts = (d: string) => lines(join(d, "docs.jsonl")).map((l) => JSON.parse(l).text as string);
  // fixtures: FIM on every train piece and best repeats under src/best/, so a matched piece has repeats and a FIM
  const cfg = JSON.parse(JSON.stringify(CFG)) as L.LbConfig; cfg.fim.rate = 1; cfg.best.paths = [{ repo: "clean/a", pathPrefix: "src/best/" }];
  writeFileSync(join(dir, "cfg.json"), JSON.stringify(cfg));
  const big = ["alpha", "beta", "gamma", "delta", "eps", "zeta", "eta", "theta"].map((n, i) => fn(`m156${n}`, i + 2)).join("\n");
  const pieces = L.splitUnits("src/big.ts", big, cfg.split);
  const hidA = block("hidA"), hidB = block("hidB");
  corpus(join(dir, "in"), [
    { text: block("keep1"), path: "src/k1.ts" },
    { text: hidA, path: "src/best/a.ts" }, // matched by the hidden tree: piece + 2 repeats + FIM
    { text: hidA.replace("+ 35;", "+ 36;"), path: "src/a2.ts" }, // near_dup of hidA: must stay dropped once hidA is
    { text: big, path: "src/big.ts" }, // split; only its second piece is in the hidden tree
    { text: hidB, path: "src/b.ts", split: "heldout" }, // matched, heldout (no FIM)
    { text: block("keep2"), path: "src/k2.ts", split: "heldout" },
  ]);
  corpus(join(dir, "prefs"), [{ text: block("pubtask", 60), path: "src/defu.ts" }], "unjs/defu"); // public refs, by name
  const tree = join(dir, NAMES[0]!); mkdirSync(join(tree, NAMES[1]!), { recursive: true });
  writeFileSync(join(tree, NAMES[1]!, `${NAMES[2]}.ts`), hidA + hidB); writeFileSync(join(tree, `${NAMES[2]}2.ts`), pieces[1]!);
  const ex = join(dir, "ex.txt"); writeFileSync(ex, EXTXT);
  const C = ["--exclusions", ex, "--config", join(dir, "cfg.json")];
  expect("fixture: big doc splits in 3+ pieces", () => pieces.length >= 3);
  // refusals first (cheap)
  writeFileSync(join(dir, "taken.txt"), "keep me\n");
  refused("matched-out without report-only (clean)", "matched_out_needs_report_only", "--in", join(dir, "in"), "--out", join(dir, "o-x"), "--matched-out", join(dir, "mx.txt"), ...C);
  refused("matched-out without report-only (dry run)", "matched_out_needs_report_only", "--in", join(dir, "in"), "--dry-run", "--matched-out", join(dir, "mx.txt"), ...C);
  expect("matched-out without report-only writes nothing", () => !existsSync(join(dir, "mx.txt")) && !existsSync(join(dir, "o-x")));
  refused("drop-hashes in report-only", "drop_hashes_not_in_report_only", "--in", join(dir, "in"), "--refs", join(dir, "prefs"), "--report-only", "--drop-hashes", join(dir, "taken.txt"), ...C);
  refused("matched-out file exists", "matched_out_exists", "--in", join(dir, "in"), "--refs", join(dir, "prefs"), "--report-only", "--matched-out", join(dir, "taken.txt"), ...C);
  expect("existing matched-out file untouched", () => readFileSync(join(dir, "taken.txt"), "utf8") === "keep me\n");
  symlinkSync(join(dir, "nowhere-target.txt"), join(dir, "dangling.txt"));
  refused("matched-out is a dangling symlink", "matched_out_exists", "--in", join(dir, "in"), "--refs", join(dir, "prefs"), "--report-only", "--matched-out", join(dir, "dangling.txt"), ...C);
  expect("dangling symlink target not created", () => !existsSync(join(dir, "nowhere-target.txt")));
  refused("matched-out dir missing", "matched_out_write", "--in", join(dir, "in"), "--refs", join(dir, "prefs"), "--report-only", "--matched-out", join(dir, "no-dir", "m.txt"), ...C);
  refused("drop-hashes file missing", "drop_hashes_missing", "--in", join(dir, "in"), "--dry-run", "--drop-hashes", join(dir, "nope.txt"), ...C);
  const h = H("m156-x"), h2 = H("m156-y");
  for (const [name, body, code] of [["uppercase", `${h.toUpperCase()}\n`, "drop_hashes_bad_line"], ["63 chars", `${h.slice(1)}\n`, "drop_hashes_bad_line"], ["65 chars", `${h}0\n`, "drop_hashes_bad_line"],
    ["trailing space", `${h} \n`, "drop_hashes_bad_line"], ["CRLF", `${h}\r\n`, "drop_hashes_bad_line"], ["duplicate", `${h}\n${h2}\n${h}\n`, "drop_hashes_duplicate"], ["empty", "", "drop_hashes_empty"],
    ["no final newline", h, "drop_hashes_no_final_newline"], ["prefixed", `sha256:${h}\n`, "drop_hashes_bad_line"]] as const) {
    writeFileSync(join(dir, `bad-${name}.txt`), body);
    refused(`drop-hashes ${name}`, code, "--in", join(dir, "in"), "--dry-run", "--drop-hashes", join(dir, `bad-${name}.txt`), ...C);
  }
  writeFileSync(join(dir, "ok1.txt"), `${h}\n`);
  refused("same drop file twice", "drop_hashes_repeated", "--in", join(dir, "in"), "--dry-run", "--drop-hashes", join(dir, "ok1.txt"), "--drop-hashes", join(dir, "ok1.txt"), ...C);
  // 1. clean with the public refs only (the corpus Auditor checks)
  let r = run("--in", join(dir, "in"), "--out", join(dir, "o1"), "--refs", join(dir, "prefs"), ...C);
  expect("clean o1", () => r.status === 0 && /drops=.*,taskset_hidden_dup:0 fingerprint=/.test(r.stdout));
  // 2. Auditor: hidden refs from an unnamed tree, then report-only with --matched-out
  r = run("--build-refs", "--tree", tree, "--out", join(dir, "hrefs"), "--exclusions", ex);
  expect("hidden refs", () => r.status === 0);
  const before = (() => { try { return texts(join(dir, "o1")); } catch { return []; } })();
  const hitN = before.filter((t) => L.tasksetContainment(t, L.buildRefs([hidA + hidB, pieces[1]!], cfg.taskset.shingleTokens)) >= cfg.taskset.maxContainment).length;
  r = run("--in", join(dir, "o1"), "--refs", join(dir, "hrefs"), "--report-only", "--matched-out", join(dir, "m.txt"), ...C);
  expect("report-only + matched-out: counts line, code, exit 2", () => r.status === 2 && r.stdout === `lb-clean report-only docs=${before.length} refFiles=2 taskset_near_dup=${hitN}\nlb-clean report-only: taskset_near_dup_found\n` && r.stderr === "" && hitN >= 6);
  const m = (() => { try { return readFileSync(join(dir, "m.txt"), "utf8"); } catch { return ""; } })();
  const mh = m.split("\n").slice(0, -1);
  const man = (() => { try { return lines(join(dir, "o1", "manifest.jsonl")).map((l) => JSON.parse(l)); } catch { return []; } })();
  expect("matched-out: sorted unique lowercase hex lines, LF, nothing else", () => m.endsWith("\n") && mh.length > 0 && mh.every((x) => /^[0-9a-f]{64}$/.test(x)) && JSON.stringify(mh) === JSON.stringify([...new Set(mh)].sort()) && !m.includes("\r") && m === mh.map((x) => x + "\n").join(""));
  expect("matched-out: the text sha256 of every matched doc (repeats once, FIM and a single piece included)", () => {
    const want = [...new Set(before.filter((t) => L.tasksetContainment(t, L.buildRefs([hidA + hidB, pieces[1]!], cfg.taskset.shingleTokens)) >= cfg.taskset.maxContainment).map((t) => H(t)))].sort();
    const fimHit = man.some((x) => x.fimOf === 1 && mh.includes(x.textSha256)), pieceHit = mh.includes(H(pieces[1]!)) && !mh.includes(H(pieces[0]!)) && !mh.includes(H(big));
    return JSON.stringify(mh) === JSON.stringify(want) && mh.length < hitN && mh.every((x) => man.some((y) => y.textSha256 === x)) && fimHit && pieceHit && mh.includes(H(hidB)); });
  // 3. us: clean again with --drop-hashes (the same input, refs and config)
  r = run("--in", join(dir, "in"), "--out", join(dir, "o2"), "--refs", join(dir, "prefs"), "--drop-hashes", join(dir, "m.txt"), ...C);
  const rep = (() => { try { return JSON.parse(readFileSync(join(dir, "o2", "clean-report.json"), "utf8")); } catch { return null; } })();
  expect("clean o2 with drop-hashes", () => r.status === 0 && rep?.drops.taskset_hidden_dup === 3 && rep.dropHashes === mh.length && rep.drops.near_dup === 1);
  const after = (() => { try { return texts(join(dir, "o2")); } catch { return null; } })();
  expect("o2 = o1 minus exactly the listed texts and what derives from them", () => !!after && JSON.stringify(after) === JSON.stringify(before.filter((t) => !mh.includes(H(t)) && !(t.startsWith(cfg.fim.prefix) && [hidA, pieces[1]!].some((p) => { const f = L.fimExample(p, cfg.salt, cfg.fim); return "text" in f && f.text === t; })))));
  // 4. Auditor again: 0, and an empty hash file
  r = run("--in", join(dir, "o2"), "--refs", join(dir, "hrefs"), "--report-only", "--matched-out", join(dir, "m2.txt"), ...C);
  expect("report-only after drop: 0, exit 0", () => r.status === 0 && /^lb-clean report-only docs=\d+ refFiles=2 taskset_near_dup=0\n$/.test(r.stdout) && readFileSync(join(dir, "m2.txt"), "utf8") === "");
  // 5. fingerprint covers the drop files
  const fp = (d: string) => { try { return JSON.parse(readFileSync(join(dir, d, "fingerprint.json"), "utf8")); } catch { return null; } };
  expect("fingerprint parts carry the drop file sha256", () => JSON.stringify(fp("o1")?.parts.dropHashesSha256) === "[]" && JSON.stringify(fp("o2")?.parts.dropHashesSha256) === JSON.stringify([H(m)]) && fp("o2").fingerprint === L.fingerprintOf(fp("o2").parts) && fp("o1").fingerprint !== fp("o2").fingerprint);
  writeFileSync(join(dir, "m-plus.txt"), m + `${h}\n`);
  r = run("--in", join(dir, "in"), "--out", join(dir, "o3"), "--refs", join(dir, "prefs"), "--drop-hashes", join(dir, "m-plus.txt"), ...C);
  expect("a changed drop file changes the fingerprint, not the output", () => r.status === 0 && fp("o3")?.fingerprint !== fp("o2")?.fingerprint && readFileSync(join(dir, "o3", "docs.jsonl"), "utf8") === readFileSync(join(dir, "o2", "docs.jsonl"), "utf8"));
  r = run("--in", join(dir, "in"), "--out", join(dir, "o4"), "--refs", join(dir, "prefs"), "--drop-hashes", join(dir, "m.txt"), "--drop-hashes", join(dir, "ok1.txt"), ...C);
  expect("two drop files: both sha256s, sorted", () => r.status === 0 && JSON.stringify(fp("o4")?.parts.dropHashesSha256) === JSON.stringify([H(m), H(`${h}\n`)].sort()) && readFileSync(join(dir, "o4", "docs.jsonl"), "utf8") === readFileSync(join(dir, "o2", "docs.jsonl"), "utf8"));
  // 6. stdout/stderr never carry doc text, a path, or a hidden-tree name
  const frags = [hidA, hidB, block("keep1"), big].flatMap((t) => t.split("\n").filter((x) => x.length > 20));
  expect("no text, path or name printed", () => outs.every((o) => !o.includes(dir) && !NAMES.some((n) => o.includes(n)) && !frags.some((f) => o.includes(f)) && !o.includes("src/") && !mh.some((x) => o.includes(x))));
  return stop ? bad.slice(0, 1) : bad;
}

test("M156: round trip, refusals, fingerprint and counts-only output (real bin)", () => {
  const dir = mkdtempSync(join(tmpdir(), "m156-cli-"));
  try { assert.deepEqual(scenarios(BIN, dir, false), []); } finally { rmSync(dir, { recursive: true, force: true }); }
});

// bin mutants: every m156-guard line has one, run on a relocated copy (the unmutated copy must pass first)
const binSrc = readFileSync(BIN, "utf8");
const BIN_MUTANTS: Record<string, [string, string]> = {
  "matched-needs-report": [`if (matchedOut !== null && !reportOnly) refuse("matched_out_needs_report_only");`, ``],
  "drop-not-report": [`if (dropPaths.length && reportOnly) refuse("drop_hashes_not_in_report_only");`, ``],
  "matched-exists": [`if (matchedOut !== null && exists(matchedOut)) refuse("matched_out_exists");`, ``],
  "drop-missing": [`if (!existsSync(p)) refuse("drop_hashes_missing");`, ``],
  "drop-parse": [`if ("code" in r) refuse(r.code);`, ``],
  "drop-repeated": [`if (new Set(dropSha).size !== dropSha.length) refuse("drop_hashes_repeated");`, ``],
  "matched-write": [`try { writeFileSync(matchedOut, hs.map((h) => h + "\\n").join(""), { flag: "wx", mode: 0o600 }); } catch { refuse("matched_out_write"); }`, `void hs;`],
  "clean-drop": [`cfg, ex, refs, drop);`, `cfg, ex, refs);`],
  "fp-drop-files": [`dropHashesSha256: dropSha,`, `dropHashesSha256: [],`],
};
// every file read / write wrap (io(...), Auditor #652): mutant = the wrap replaced by a plain call
const IO_MUTANTS: Record<string, [string, string]> = {
  "ex-read": [`io("exclusions_read", () => readFileSync(exPath!))`, `readFileSync(exPath!)`],
  "docs-read": [`io("input_read", () => readFileSync(dp))`, `readFileSync(dp)`],
  "man-read": [`io("input_read", () => readFileSync(mp))`, `readFileSync(mp)`],
  "refs-write": [`io("output_write", () => { rmSync(out,`, `((_c: string, f: () => void) => f())("output_write", () => { rmSync(out,`],
  "tasks-read": [`io("tasks_read", () => JSON.parse(readFileSync(tasksPath, "utf8")).tasks)`, `JSON.parse(readFileSync(tasksPath, "utf8")).tasks`],
  "drop-read": [`io("drop_hashes_read", () => readFileSync(p))`, `readFileSync(p)`],
  "cfg-read": [`io("config_read", () => readFileSync(cfgPath))`, `readFileSync(cfgPath)`],
  "code-read": [`io("code_read", () => readFileSync(join(ROOT, p)))`, `readFileSync(join(ROOT, p))`],
  "out-write": [`io("output_write", () => { rmSync(outDir!,`, `((_c: string, f: () => void) => f())("output_write", () => { rmSync(outDir!,`],
};
const libUrl = pathToFileURL(join(repo, "peaceai", "lib")).href;
/** The bin relocated (lib imports by file URL) with ROOT set to `root`. */
const reloc = (src: string, root: string) => src.replace(/"\.\.\/lib\/([\w.-]+)"/g, (_, f) => `"${libUrl}/${f}"`).replace(`new URL("../../", import.meta.url).pathname`, JSON.stringify(root + "/"));
const tagsOf = (src: string) => src.split("\n").flatMap((l) => { const x = /\/\/ m156-guard:([\w-]+)/.exec(l); return x ? [{ id: x[1]!, line: l }] : []; });
// as root (or with read-override capabilities) chmod 000 does not block reads: those cases are skipped, not passed
const chmodBlocks = (() => {
  if (process.getuid?.() === 0) return false;
  const d = mkdtempSync(join(tmpdir(), "m156-perm-")), f = join(d, "x");
  try { writeFileSync(f, "x"); chmodSync(f, 0o000); try { readFileSync(f); return false; } catch { return true; } }
  finally { chmodSync(f, 0o600); rmSync(d, { recursive: true, force: true }); }
})();
/** Unreadable inputs (a directory where a file is read; mode 000 when chmod blocks reads here) and unwritable
 * outputs: each must refuse with only its fixed code on stdout, nothing on stderr, no path. `bin` has ROOT = the repo;
 * `codeBin` has ROOT = a copy whose lbclean.ts is a directory (the fingerprint's code read). */
function ioScenarios(bin: string, codeBin: string, dir: string, stop: boolean): string[] {
  const bad: string[] = [], locked: string[] = [];
  const corpus = (d: string, repoName = "clean/a") => { mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "docs.jsonl"), JSON.stringify({ doc: 0, text: block("io") }) + "\n");
    writeFileSync(join(d, "manifest.jsonl"), JSON.stringify({ doc: 0, split: "train", repo: repoName, path: "src/io.ts", function: "f0" }) + "\n"); return d; };
  const ex = join(dir, "ex.txt"); writeFileSync(ex, EXTXT);
  const cfg = join(repo, "peaceai/model/lb-clean.json");
  const inOk = corpus(join(dir, "in-ok")), refsOk = corpus(join(dir, "refs-ok"), "unjs/defu");
  const asDir = (d: string, f: string) => { rmSync(join(d, f)); mkdirSync(join(d, f)); return d; };
  const lock = (p: string) => { chmodSync(p, 0o000); locked.push(p); return p; };
  const mk = (n: string) => { const d = join(dir, n); mkdirSync(d, { recursive: true }); return d; };
  writeFileSync(join(dir, "afile"), "x\n");
  writeFileSync(join(dir, "drop.txt"), `${H("io")}\n`); writeFileSync(join(dir, "badjson.json"), "{ not json");
  const tree = mk("tree-io"); writeFileSync(join(tree, "a.ts"), block("t"));
  const cases: [string, string, () => string[], string?][] = [
    ["--in docs.jsonl is a directory", "input_read", () => ["--in", asDir(corpus(join(dir, "in-dd")), "docs.jsonl"), "--dry-run", "--exclusions", ex]],
    ["--in manifest.jsonl is a directory", "input_read", () => ["--in", asDir(corpus(join(dir, "in-md")), "manifest.jsonl"), "--dry-run", "--exclusions", ex]],
    ["--refs docs.jsonl is a directory", "input_read", () => ["--in", inOk, "--refs", asDir(corpus(join(dir, "refs-dd"), "unjs/defu"), "docs.jsonl"), "--dry-run", "--exclusions", ex]],
    ["--refs manifest.jsonl is a directory", "input_read", () => ["--in", inOk, "--refs", asDir(corpus(join(dir, "refs-md"), "unjs/defu"), "manifest.jsonl"), "--report-only", "--exclusions", ex]],
    ["--exclusions is a directory", "exclusions_read", () => ["--in", inOk, "--dry-run", "--exclusions", mk("ex-dir")]],
    ["--config is a directory", "config_read", () => ["--in", inOk, "--dry-run", "--exclusions", ex, "--config", mk("cfg-dir")]],
    ["--tasks is a directory", "tasks_read", () => ["--build-refs", "--tasks", mk("tasks-dir"), "--trees", mk("trees-x"), "--out", join(dir, "tr-out"), "--exclusions", ex]],
    ["--tasks is not JSON", "tasks_read", () => ["--build-refs", "--tasks", join(dir, "badjson.json"), "--trees", mk("trees-x"), "--out", join(dir, "tr-out2"), "--exclusions", ex]],
    ["--drop-hashes is a directory", "drop_hashes_read", () => ["--in", inOk, "--dry-run", "--exclusions", ex, "--drop-hashes", mk("drop-dir")]],
    ["--out under a file", "output_write", () => ["--in", inOk, "--out", join(dir, "afile", "sub"), "--exclusions", ex, "--refs", refsOk]],
    ["--build-refs --out under a file", "output_write", () => ["--build-refs", "--tree", tree, "--out", join(dir, "afile", "sub2"), "--exclusions", ex]],
    ["fingerprint code file unreadable", "code_read", () => ["--in", inOk, "--dry-run", "--exclusions", ex, "--config", cfg], "code"],
  ];
  if (chmodBlocks) cases.push(
    ["docs.jsonl mode 000", "input_read", () => { const d = corpus(join(dir, "in-d0")); lock(join(d, "docs.jsonl")); return ["--in", d, "--dry-run", "--exclusions", ex]; }],
    ["manifest.jsonl mode 000", "input_read", () => { const d = corpus(join(dir, "in-m0")); lock(join(d, "manifest.jsonl")); return ["--in", d, "--dry-run", "--exclusions", ex]; }],
    ["refs docs.jsonl mode 000", "input_read", () => { const d = corpus(join(dir, "refs-d0"), "unjs/defu"); lock(join(d, "docs.jsonl")); return ["--in", inOk, "--refs", d, "--report-only", "--exclusions", ex]; }],
    ["exclusions mode 000", "exclusions_read", () => { writeFileSync(join(dir, "ex0.txt"), EXTXT); return ["--in", inOk, "--dry-run", "--exclusions", lock(join(dir, "ex0.txt"))]; }],
    ["config mode 000", "config_read", () => { cpSync(cfg, join(dir, "cfg0.json")); return ["--in", inOk, "--dry-run", "--exclusions", ex, "--config", lock(join(dir, "cfg0.json"))]; }],
    ["drop-hashes mode 000", "drop_hashes_read", () => { writeFileSync(join(dir, "drop0.txt"), `${H("io")}\n`); return ["--in", inOk, "--dry-run", "--exclusions", ex, "--drop-hashes", lock(join(dir, "drop0.txt"))]; }],
    ["tasks mode 000", "tasks_read", () => { writeFileSync(join(dir, "tasks0.json"), "{}"); return ["--build-refs", "--tasks", lock(join(dir, "tasks0.json")), "--trees", mk("trees-x"), "--out", join(dir, "tr-out3"), "--exclusions", ex]; }],
  );
  try {
    for (const [name, code, args, which] of cases) {
      if (stop && bad.length) break;
      try {
        const r = spawnSync(tsx, [which === "code" ? codeBin : bin, ...args()], { cwd: repo, encoding: "utf8" });
        if (r.status !== 1 || r.stdout !== `lb-clean refused: ${code}\n`) bad.push(`${name}: status ${r.status}, not the fixed code`);
        else if (r.stderr !== "") bad.push(`${name}: stderr not empty`);
        else if ((r.stdout + r.stderr).includes(dir)) bad.push(`${name}: a path is printed`);
      } catch { bad.push(`${name}: threw`); }
    }
  } finally { for (const p of locked) chmodSync(p, 0o600); }
  return bad;
}
/** A root copy for codeBin: the config, with peaceai/lib/lbclean.ts a directory. */
const badRoot = (dir: string) => { const r = join(dir, "root"); mkdirSync(join(r, "peaceai", "lib", "lbclean.ts"), { recursive: true }); mkdirSync(join(r, "peaceai", "model"), { recursive: true });
  cpSync(join(repo, "peaceai/model/lb-clean.json"), join(r, "peaceai/model/lb-clean.json")); return r; };

test("M156: unreadable or directory inputs and unwritable outputs refuse with a fixed code, nothing on stderr, no path", { timeout: 600_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "m156-io-"));
  try {
    const codeBin = join(dir, "code-bin.mts"); writeFileSync(codeBin, reloc(binSrc, badRoot(dir)));
    const w = join(dir, "w"); mkdirSync(w); assert.deepEqual(ioScenarios(BIN, codeBin, w, false), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M156 mutation: every io wrap is tagged and each mutant fails an io scenario", { timeout: 1_200_000 }, () => {
  const tagged = tagsOf(binSrc).filter((t) => t.id in IO_MUTANTS);
  assert.deepEqual(tagged.map((t) => t.id).sort(), Object.keys(IO_MUTANTS).sort());
  for (const t of tagged) assert.ok(t.line.includes(IO_MUTANTS[t.id]![0]), `mutant site on its tagged line: ${t.id}`);
  assert.equal((binSrc.match(/\bio\("/g) ?? []).length, Object.keys(IO_MUTANTS).length + 1, "every io wrap but the typescript package.json read has a mutant");
  const dir = mkdtempSync(join(tmpdir(), "m156-iomut-"));
  try {
    const root = badRoot(dir);
    const one = (name: string, src: string) => { const d = join(dir, name); mkdirSync(d); const b = join(d, "bin.mts"), cb = join(d, "code-bin.mts");
      writeFileSync(b, reloc(src, repo)); writeFileSync(cb, reloc(src, root)); const w = join(d, "w"); mkdirSync(w); return ioScenarios(b, cb, w, true); };
    assert.deepEqual(one("control", binSrc), [], "relocated unmutated copy");
    for (const [id, [from, to]] of Object.entries(IO_MUTANTS)) {
      assert.ok(binSrc.includes(from), `mutant site not found: ${id}`);
      assert.ok(one(`mut-${id}`, binSrc.replace(from, to)).length > 0, `mutant survived: ${id}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M156 mutation: every bin guard is tagged and each mutant fails a scenario", { timeout: 1_200_000 }, () => {
  const tagged = tagsOf(binSrc).filter((t) => !(t.id in IO_MUTANTS));
  assert.deepEqual(tagged.map((t) => t.id).sort(), Object.keys(BIN_MUTANTS).sort());
  for (const t of tagged) assert.ok(t.line.includes(BIN_MUTANTS[t.id]![0]), `mutant site on its tagged line: ${t.id}`);
  const fixed = reloc(binSrc, repo);
  const dir = mkdtempSync(join(tmpdir(), "m156-mut-"));
  try {
    const one = (name: string, src: string) => { const d = join(dir, name); mkdirSync(d); const f = join(d, "bin.mts"); writeFileSync(f, src); return scenarios(f, d, true); };
    assert.deepEqual(one("control", fixed), [], "relocated unmutated copy");
    for (const [id, [from, to]] of Object.entries(BIN_MUTANTS)) {
      assert.ok(fixed.includes(from), `mutant site not found: ${id}`);
      assert.ok(one(`mut-${id}`, fixed.replace(from, to)).length > 0, `mutant survived: ${id}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M156: the committed drop-hash file exists, is add-only against main, and its guard cases pass", (t) => {
  assert.ok(existsSync(join(repo, DROP_FILE)), DROP_FILE);
  const cur = readFileSync(join(repo, DROP_FILE), "utf8");
  assert.equal(dropLogAddOnlyProblem("", cur), null, "valid (empty or hash lines only)");
  assert.deepEqual(failingDropLogCases(dropLogAddOnlyProblem), []);
  let base = "";
  try { base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* shallow CI checkout */ }
  if (!base) { t.skip("no origin/main here (shallow checkout)"); return; }
  const show = (rev: string) => { try { return execFileSync("git", ["show", `${rev}:${DROP_FILE}`], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };
  assert.equal(dropLogAddOnlyProblem(show(base), show("HEAD")), null, `${DROP_FILE} is add-only against main`);
});

const TAG = /\/\/ guard:([\w-]+)$/;
const logSrc = readFileSync(resolve(import.meta.dirname, "m156-droplog.ts"), "utf8").split("\n");
const logGuards = logSrc.flatMap((l, i) => { const x = TAG.exec(l); return x ? [{ id: x[1]!, line: i }] : []; });
test("M156 mutation: the drop-file guard tags; the unmutated copy passes and deleting any guard fails a case", async () => {
  assert.deepEqual(logGuards.map((g) => g.id).sort(), ["drop-log-file", "drop-log-main-newline", "drop-log-newline", "drop-log-prefix"]);
  const libDir = join(repo, "peaceai", "lib"), dir = mkdtempSync(join(tmpdir(), "m156-log-"));
  const copy = (keep: (i: number) => boolean) => logSrc.filter((_, i) => keep(i)).join("\n").replace(/from "\.\.\/lib\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`);
  try {
    writeFileSync(join(dir, "control.ts"), copy(() => true));
    assert.deepEqual(failingDropLogCases((await import(pathToFileURL(join(dir, "control.ts")).href)).dropLogAddOnlyProblem), []);
    for (const g of logGuards) {
      const f = join(dir, `mut-${g.id}.ts`); writeFileSync(f, copy((i) => i !== g.line));
      assert.ok(failingDropLogCases((await import(pathToFileURL(f).href)).dropLogAddOnlyProblem).length > 0, `no case notices guard:${g.id} removed`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
