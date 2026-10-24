// M101 (Auditor #491 ruling): a DSL form is used only with >= DERIVE_FORM_BAR replaying upstream evidence entries.
// peaceai/rules/proposals/m101-template-joins-evidence.json holds the mined entries for the template-join forms (tmpl:
// an n-ary string join found by alignment; str: a number written as its decimal text). TEMPLATE_FORM_EVIDENCE in
// peaceai/lib/derive.ts must equal the per-form counts here. A form at the bar replays fully: deriveProgram from the
// recorded examples gives the recorded expression. A form under the bar stays off: deriveProgram never builds it, and
// the entry is replayed by the alignment alone (templateFits with the form on).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileProgram, DERIVE_FORM_BAR, DERIVE_MAX_EXAMPLES, deriveProgram, derivedExprProblem, evalProgram, TEMPLATE_FORM_EVIDENCE, templateFits } from "../lib/derive.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
type DV = number | string | boolean;
type Form = "tmpl" | "str";
type Ex = { repo: string; commit: string; module: string; fn: string; params: { name: string; type: "number" | "string" }[]; ret: "string"; examples: { args: DV[]; out: DV }[]; expr: string; forms: Form[]; heldOut: { right: number; wrong: number }; farOut: { right: number; wrong: number }; upstream: string; path: string; fileBlob: string; sha256: string; fixture: string; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m101-template-joins-evidence.json")) as { schema: string; bar: number; manifestSha256: string; forms: Record<Form, number>; examples: Ex[] };
const M99 = JSON.parse(read("peaceai/rules/proposals/m99-derive-from-behavior-evidence.json")) as { manifestSha256: string; examples: { repo: string; fn: string }[] };
const ON = { tmpl: DERIVE_FORM_BAR, str: DERIVE_FORM_BAR };
const on = (f: Form) => TEMPLATE_FORM_EVIDENCE.tmpl >= DERIVE_FORM_BAR && (f === "tmpl" || TEMPLATE_FORM_EVIDENCE.str >= DERIVE_FORM_BAR);
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const formsOf = (j: string): Form[] => (["tmpl", "str"] as Form[]).filter((f) => j.includes(`"op":"${f}"`));

test("template-join evidence: per-form counts equal TEMPLATE_FORM_EVIDENCE; the bar is the engine's", () => {
  assert.equal(EV.schema, "peaceai-m101-template-joins-evidence:v1");
  assert.equal(EV.bar, DERIVE_FORM_BAR);
  assert.equal(DERIVE_FORM_BAR, 10);
  const counts = { tmpl: 0, str: 0 };
  for (const e of EV.examples) for (const f of e.forms) counts[f]++;
  assert.deepEqual(EV.forms, counts);
  assert.deepEqual({ ...TEMPLATE_FORM_EVIDENCE }, counts, "the engine's recorded counts are the evidence file's");
});

test("template-join evidence: modules blob-pinned and hold the upstream function; each entry replays", () => {
  assert.equal(new Set(EV.examples.map((e) => `${e.repo}\0${e.module}\0${e.fn}`)).size, EV.examples.length);
  const perRepo = new Map<string, number>();
  for (const e of [...M99.examples, ...EV.examples]) perRepo.set(e.repo, (perRepo.get(e.repo) ?? 0) + 1);
  assert.ok([...perRepo.values()].every((n) => n <= 3), "at most 3 per repo (with the M99 evidence)");
  const m99 = new Set(M99.examples.map((e) => `${e.repo}\0${e.fn}`));
  const KNOWN_REFUSALS = new Set(["schmayterling/comment-issues getIssueUrl"]);
  const refused: string[] = [];
  let tmplReplayed = 0;
  for (const e of EV.examples) {
    assert.ok(!m99.has(`${e.repo}\0${e.fn}`), `${e.repo} ${e.fn} is not an M99 entry`);
    const b = readFileSync(resolve(root, e.fixture));
    assert.ok(b.length <= 65536, e.fixture);
    assert.equal(gitBlob(b), e.fileBlob, e.fixture);
    assert.equal(createHash("sha256").update(b).digest("hex"), e.sha256, e.fixture);
    assert.equal(e.path, e.module);
    assert.ok(b.toString("utf8").includes(e.upstream) && new RegExp(`\\b${e.fn}\\b`).test(e.upstream), `${e.repo} ${e.fn} upstream`);
    assert.ok(e.examples.length >= 4 && e.examples.length <= DERIVE_MAX_EXAMPLES, `${e.repo} ${e.fn} examples`);
    assert.ok(e.heldOut.right > 0 && e.heldOut.wrong === 0 && e.farOut.wrong === 0, `${e.repo} ${e.fn} held out`);
    assert.ok(e.forms.length > 0);
    const names = e.params.map((p) => p.name);
    assert.equal(derivedExprProblem(e.expr, names), null, `${e.repo} ${e.fn} whitelist`);
    const r = deriveProgram({ params: e.params, ret: e.ret, examples: e.examples });
    if (KNOWN_REFUSALS.has(`${e.repo} ${e.fn}`)) {
      // m103 unread gate (Auditor #497 ruling): providerName only varies while repoUrl = "", so it is never shown irrelevant.
      assert.ok(!r.ok && r.reason === "derive_under_specified", `${e.repo} ${e.fn}: the known refusal (${r.ok ? "derived" : r.reason})`);
      refused.push(`${e.repo} ${e.fn}`);
      continue;
    }
    if (e.forms.every(on) && e.forms.includes("tmpl")) tmplReplayed++;
    if (e.forms.every(on)) {
      assert.ok(r.ok, `${e.repo} ${e.fn}: ${r.ok ? "" : r.reason}`);
      assert.equal(compileProgram(r.fit.program, names), e.expr, `${e.repo} ${e.fn}`);
      assert.deepEqual(formsOf(JSON.stringify(r.fit.program)), e.forms, `${e.repo} ${e.fn} forms`);
      for (const x of e.examples) assert.equal(evalProgram(r.fit.program, x.args), x.out);
    } else {
      // a form under the bar is never built; the alignment with the form on finds the recorded expression
      if (r.ok) assert.ok(formsOf(JSON.stringify(r.fit.program)).every(on), `${e.repo} ${e.fn}: an off form was used`);
      const fits = templateFits(e.params, e.examples, ON);
      const hit = fits.find((f) => compileProgram(f, names) === e.expr);
      assert.ok(hit, `${e.repo} ${e.fn}: the alignment finds ${e.expr}`);
      assert.deepEqual(formsOf(JSON.stringify(hit)), e.forms, `${e.repo} ${e.fn} forms`);
      for (const x of e.examples) assert.equal(evalProgram(hit!, x.args), x.out);
    }
  }
  assert.deepEqual(refused, [...KNOWN_REFUSALS], "every known refusal is an evidence entry and refuses");
  assert.equal(tmplReplayed, 35, "replayed tmpl entries");
  assert.ok(tmplReplayed >= DERIVE_FORM_BAR, "replayed tmpl entries reach the bar");
});

test("template-join evidence: permissive licenses by hash in THIRD_PARTY_NOTICES; the fixtures dir holds exactly them", () => {
  const notices = read("THIRD_PARTY_NOTICES");
  const listed = new Set<string>();
  for (const e of EV.examples) {
    assert.ok(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(e.license), e.repo);
    assert.ok(notices.includes(`repo: ${e.repo}\nlicense: ${e.license} (`) && notices.includes(`sha256 of trimmed text ${e.licenseSha256})`), e.repo);
    assert.ok(notices.includes(` ${e.fixture}\n`), e.fixture);
    listed.add(e.fixture.split("/").pop()!);
  }
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m101-tj"));
  for (const f of have) assert.ok(listed.has(f), f);
  assert.equal(have.length, listed.size);
});

test("template-join evidence: no overlap with the training corpus or the ext-manifest; no Peace repos", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  assert.equal(EV.manifestSha256, M99.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); assert.ok(!shas.has(e.sha256), e.fixture); assert.ok(!e.repo.startsWith("PeaceG03/")); }
});
