import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { indexGitTree, parsePublicOrigin, PUBLIC_ORIGIN_FILE, PUBLIC_ORIGIN_SCHEMA } from "../lib/coreindex.ts";
import { emptyIndex, findCoreText } from "../lib/coretext.ts";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
// Distinctive long lines (built at runtime so this file holds no fixed private-looking text).
const line = (tag: string) => `export function ${tag}PublicOriginFixtureHelper(alphaValue: number, betaValue: number) { return alphaValue + betaValue; }`;
const A = line("listed") + "\n", B = line("changed") + "\n", C = line("unlisted") + "\n";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pub-origin-"));
  for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}
const allow = (files: { path: string; sha256: string }[]) => JSON.stringify({ schema: PUBLIC_ORIGIN_SCHEMA, files: files.map((f) => ({ ...f, origin: "PeaceG03/PeaceSTOCKS" })) });
const flagged = (dir: string, text: string, raw = false) => {
  const idx = indexGitTree(dir, () => true, raw);
  return { lines: findCoreText(text.split("\n"), idx.text, emptyIndex()).lineHits, raw: idx.raw?.some((r) => r.includes(text.trim())) ?? null, idx };
};

test("public-origin: an allowlisted file (exact path + sha256) is skipped by the core-text index and the raw substring index", () => {
  const dir = repo({ "pkg/a.ts": A, [PUBLIC_ORIGIN_FILE]: allow([{ path: "pkg/a.ts", sha256: sha(A) }]) });
  try {
    const r = flagged(dir, A, true);
    assert.equal(r.lines, 0);
    assert.equal(r.raw, false);
    assert.deepEqual(r.idx.publicOrigin, ["pkg/a.ts"]);
    assert.ok(r.idx.paths.has("pkg/a.ts"), "paths are kept");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("public-origin: the same path with changed content is flagged (fail closed)", () => {
  const dir = repo({ "pkg/a.ts": B, [PUBLIC_ORIGIN_FILE]: allow([{ path: "pkg/a.ts", sha256: sha(A) }]) });
  try {
    const r = flagged(dir, B, true);
    assert.ok(r.lines > 0);
    assert.equal(r.raw, true);
    assert.equal(r.idx.publicOrigin, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("public-origin: an unlisted file is flagged, even with the same bytes as a listed one", () => {
  const dir = repo({ "pkg/a.ts": A, "pkg/c.ts": C, "other/a.ts": A, [PUBLIC_ORIGIN_FILE]: allow([{ path: "pkg/a.ts", sha256: sha(A) }]) });
  try {
    assert.ok(flagged(dir, C).lines > 0, "unlisted file");
    // other/a.ts carries the listed bytes at an unlisted path: still indexed, so the text is still flagged.
    const r = flagged(dir, A, true);
    assert.ok(r.lines > 0);
    assert.deepEqual(r.idx.publicOrigin, ["pkg/a.ts"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("public-origin: an untracked, malformed or wildcard allowlist skips nothing", () => {
  const cases: [string, string][] = [
    ["not json", "NOT_JSON"],
    [JSON.stringify({ schema: "x", files: [] }), "BAD_SCHEMA"],
    [allow([{ path: "pkg/*.ts", sha256: sha(A) }]), "BAD_PATH"],
    [allow([{ path: "pkg/", sha256: sha(A) }]), "BAD_PATH"],
    [allow([{ path: "../pkg/a.ts", sha256: sha(A) }]), "BAD_PATH"],
    [allow([{ path: "pkg/a.ts", sha256: "*" }]), "BAD_SHA256"],
    [allow([{ path: "pkg/a.ts", sha256: sha(A) }, { path: "pkg/a.ts", sha256: sha(B) }]), "DUPLICATE_PATH"],
    [JSON.stringify({ schema: PUBLIC_ORIGIN_SCHEMA, files: [{ path: "pkg/a.ts", sha256: sha(A) }] }), "NO_ORIGIN"],
  ];
  for (const [text, reason] of cases) {
    assert.deepEqual(parsePublicOrigin(text), { ok: false, reason });
    const dir = repo({ "pkg/a.ts": A, [PUBLIC_ORIGIN_FILE]: text });
    try { assert.ok(flagged(dir, A).lines > 0, reason); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  // A well-formed allowlist that the checkout does not track is ignored.
  const dir = repo({ "pkg/a.ts": A });
  try {
    writeFileSync(join(dir, PUBLIC_ORIGIN_FILE.split("/").pop()!), allow([{ path: "pkg/a.ts", sha256: sha(A) }]));
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, PUBLIC_ORIGIN_FILE), allow([{ path: "pkg/a.ts", sha256: sha(A) }]));
    assert.ok(flagged(dir, A).lines > 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
