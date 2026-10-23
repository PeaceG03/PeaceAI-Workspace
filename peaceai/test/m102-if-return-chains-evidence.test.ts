// M102 (Auditor #491 ruling): a DSL form is used only with >= DERIVE_FORM_BAR replaying upstream evidence entries.
// peaceai/rules/proposals/m102-if-return-chains-evidence.json holds the mined entries for the string-order form (sle:
// `s <= t`, two string parameters in code-unit order). ORDER_FORM_EVIDENCE in peaceai/lib/derive.ts must equal the
// count here. At the bar every entry replays fully: deriveCandidate (search + witness gates) from the recorded examples
// alone gives the recorded expression. Under the bar the form stays off: it is never built. deriveProgram then applies
// the round-3 form gate (m99 evidence file, the single source): a replayed program using a form under DERIVE_FORM_BAR
// there is refused as derive_unevidenced_form, never emitted (ternary, for the comparators and min / max, until M104 mined it to 12).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileProgram, DERIVE_FORM_BAR, DERIVE_MAX_EXAMPLES, deriveCandidate, deriveProgram, derivedExprProblem, evalProgram, ORDER_FORM_EVIDENCE, unevidencedForms } from "../lib/derive.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
type DV = number | string | boolean;
type Form = "sle";
type Ex = { repo: string; commit: string; module: string; fn: string; params: { name: string; type: "number" | "string" | "boolean" }[]; ret: "number" | "string" | "boolean"; examples: { args: DV[]; out: DV }[]; expr: string; forms: Form[]; heldOut: { right: number; wrong: number }; farOut: { right: number; wrong: number }; upstream: string; path: string; fileBlob: string; sha256: string; fixture: string; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m102-if-return-chains-evidence.json")) as { schema: string; bar: number; manifestSha256: string; forms: Record<Form, number>; examples: Ex[] };
const M99 = JSON.parse(read("peaceai/rules/proposals/m99-derive-from-behavior-evidence.json")) as { manifestSha256: string; examples: { repo: string; fn: string }[] };
const M101 = JSON.parse(read("peaceai/rules/proposals/m101-template-joins-evidence.json")) as { examples: { repo: string; fn: string }[] };
const on = ORDER_FORM_EVIDENCE.sle >= DERIVE_FORM_BAR;
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const usesSle = (j: string) => j.includes('"op":"sle"');
const norm = (e: Ex) => e.params.reduce((x, p, i) => x.replace(new RegExp(`\\b${p.name}\\b`, "g"), `p${i}`), e.expr);

test("if-return-chains evidence: the count equals ORDER_FORM_EVIDENCE; the bar is the engine's", () => {
  assert.equal(EV.schema, "peaceai-m102-if-return-chains-evidence:v1");
  assert.equal(EV.bar, DERIVE_FORM_BAR);
  assert.equal(DERIVE_FORM_BAR, 10);
  const counts = { sle: EV.examples.filter((e) => e.forms.includes("sle")).length };
  assert.deepEqual(EV.forms, counts);
  assert.deepEqual({ ...ORDER_FORM_EVIDENCE }, counts, "the engine's recorded count is the evidence file's");
  // Auditor #495 B2: isCurrentNav (prefix match) and hostnameMatches (wildcard match) dropped as not string order
  assert.equal(ORDER_FORM_EVIDENCE.sle, 11);
  assert.ok(!EV.examples.some((e) => ["isCurrentNav", "hostnameMatches"].includes(e.fn)));
});

test("if-return-chains evidence: modules blob-pinned and hold the upstream function; each entry replays", () => {
  assert.equal(new Set(EV.examples.map((e) => `${e.repo}\0${e.module}\0${e.fn}`)).size, EV.examples.length);
  const perRepo = new Map<string, number>();
  for (const e of [...M99.examples, ...M101.examples, ...EV.examples]) perRepo.set(e.repo, (perRepo.get(e.repo) ?? 0) + 1);
  assert.ok([...perRepo.values()].every((n) => n <= 3), "at most 3 per repo (with the M99 and M101 evidence)");
  const shapes = new Map<string, number>();
  for (const e of EV.examples) shapes.set(norm(e), (shapes.get(norm(e)) ?? 0) + 1);
  assert.ok([...shapes.values()].every((n) => n <= 2), "at most 2 per expression shape");
  const prior = new Set([...M99.examples, ...M101.examples].map((e) => `${e.repo}\0${e.fn}`));
  for (const e of EV.examples) {
    assert.ok(!prior.has(`${e.repo}\0${e.fn}`), `${e.repo} ${e.fn} is not an M99 or M101 entry`);
    const b = readFileSync(resolve(root, e.fixture));
    assert.ok(b.length <= 65536, e.fixture);
    assert.equal(gitBlob(b), e.fileBlob, e.fixture);
    assert.equal(createHash("sha256").update(b).digest("hex"), e.sha256, e.fixture);
    assert.equal(e.path, e.module);
    assert.ok(b.toString("utf8").includes(e.upstream) && new RegExp(`\\b${e.fn}\\b`).test(e.upstream), `${e.repo} ${e.fn} upstream`);
    assert.ok(e.examples.length >= 4 && e.examples.length <= DERIVE_MAX_EXAMPLES, `${e.repo} ${e.fn} examples`);
    assert.ok(e.heldOut.right > 0 && e.heldOut.wrong === 0 && e.farOut.wrong === 0, `${e.repo} ${e.fn} held out`);
    assert.deepEqual(e.forms, ["sle"]);
    const names = e.params.map((p) => p.name);
    assert.equal(derivedExprProblem(e.expr, names), null, `${e.repo} ${e.fn} whitelist`);
    const r = deriveCandidate({ params: e.params, ret: e.ret, examples: e.examples });
    if (r.ok) {
      const p = deriveProgram({ params: e.params, ret: e.ret, examples: e.examples });
      const forms = unevidencedForms(r.fit.program);
      if (forms.length) assert.ok(!p.ok && p.reason === "derive_unevidenced_form" && JSON.stringify((p as { forms?: unknown }).forms) === JSON.stringify(forms), `${e.repo} ${e.fn}: form gate`);
      else assert.ok(p.ok && compileProgram(p.fit.program, names) === compileProgram(r.fit.program, names), `${e.repo} ${e.fn}: emitted`);
    }
    if (on) {
      assert.ok(r.ok, `${e.repo} ${e.fn}: ${r.ok ? "" : r.reason}`);
      assert.equal(compileProgram(r.fit.program, names), e.expr, `${e.repo} ${e.fn}`);
      assert.ok(usesSle(JSON.stringify(r.fit.program)), `${e.repo} ${e.fn} uses sle`);
      for (const x of e.examples) assert.equal(evalProgram(r.fit.program, x.args), x.out);
    } else if (r.ok) assert.ok(!usesSle(JSON.stringify(r.fit.program)), `${e.repo} ${e.fn}: the off form was used`);
  }
});

test("if-return-chains evidence: permissive licenses by hash in THIRD_PARTY_NOTICES; the fixtures dir holds exactly them", () => {
  const notices = read("THIRD_PARTY_NOTICES");
  const listed = new Set<string>();
  for (const e of EV.examples) {
    assert.ok(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(e.license), e.repo);
    assert.ok(notices.includes(`repo: ${e.repo}\nlicense: ${e.license} (`) && notices.includes(`sha256 of trimmed text ${e.licenseSha256})`), e.repo);
    assert.ok(notices.includes(` ${e.fixture}\n`), e.fixture);
    listed.add(e.fixture.split("/").pop()!);
  }
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m102-irc"));
  for (const f of have) assert.ok(listed.has(f), f);
  assert.equal(have.length, listed.size);
});

test("if-return-chains evidence: no overlap with the training corpus or the ext-manifest; no Peace repos", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  assert.equal(EV.manifestSha256, M99.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); assert.ok(!shas.has(e.sha256), e.fixture); assert.ok(!e.repo.startsWith("PeaceG03/")); }
});
