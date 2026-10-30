// M143 fixture helper: unpacks the vendored bundles (peaceai/test/fixtures/m143-search/*.bundle.txt, verbatim
// upstream files, see THIRD_PARTY_NOTICES) and builds the synthetic near-miss / escape repo, all under one
// os.tmpdir() scratch directory the caller removes. Nothing is written inside this repository.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

export const BUNDLE_DIR = resolve(import.meta.dirname, "fixtures/m143-search");
export const BUNDLES = {
  isWhat: { repo: "mesqueeb/is-what", commit: "864e944abd8eb6f6356de03ff67339c71440d6bb", file: "mesqueeb__is-what-864e944abd8e.bundle.txt" },
  cbw: { repo: "dsherret/code-block-writer", commit: "96de18325769606589307281ce355f18eca830b2", file: "dsherret__code-block-writer-96de18325769.bundle.txt" },
} as const;

export interface Bundle { repo: string; commit: string; files: { path: string; bytes: Buffer }[] }

/** Parses a bundle; every file's byte count and sha256 must match its header. */
export function parseBundle(buf: Buffer): Bundle {
  const header = /^peaceai-vendored-bundle:v1\nrepo: (\S+)\ncommit: ([0-9a-f]{40})\nlicense: [^\n]+\nfiles: (\d+)\nnote: [^\n]*\n/.exec(buf.toString("latin1"));
  if (!header) throw new Error("bad bundle header");
  let at = Buffer.byteLength(header[0], "latin1");
  const files: Bundle["files"] = [];
  while (at < buf.length) {
    const nl = buf.indexOf(10, at);
    const m = /^@@@ file (\S+) (\d+) ([0-9a-f]{64})$/.exec(buf.subarray(at, nl).toString("latin1"));
    if (!m) throw new Error(`bad bundle entry at ${at}`);
    const bytes = buf.subarray(nl + 1, nl + 1 + Number(m[2]));
    if (createHash("sha256").update(bytes).digest("hex") !== m[3]) throw new Error(`sha mismatch ${m[1]}`);
    if (m[1]!.split("/").some((s) => s === ".." || s === "") || m[1]!.startsWith("/")) throw new Error("bad bundle path");
    files.push({ path: m[1]!, bytes: Buffer.from(bytes) });
    at = nl + 1 + Number(m[2]) + 1;
  }
  if (files.length !== Number(header[3])) throw new Error("bundle file count");
  return { repo: header[1]!, commit: header[2]!, files };
}

function put(root: string, rel: string, data: string | Buffer) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), data);
}

export function unpack(file: string, into: string): string {
  const b = parseBundle(readFileSync(join(BUNDLE_DIR, file)));
  for (const f of b.files) put(into, f.path, f.bytes);
  return into;
}

/** The synthetic repo: near misses (same name in comments / strings / locals, re-exports, default vs named), ignore rules and escape attempts. */
export function buildNearMiss(root: string, outside: string) {
  const files: Record<string, string> = {
    ".gitignore": "node_modules/\n.env\n*.log\nbuild/\n!keep.log\n/secret-root.txt\n",
    "src/.gitignore": "generated-*.ts\n",
    "src/core.ts": "/** Parses a count; parseCount rejects negatives. */\nexport function parseCount(s: string): number {\n  const n = Number(s);\n  if (n < 0) throw new Error(\"negative count\");\n  return n;\n}\n\nexport const RETRY_LIMIT = 3;\n",
    "src/notes.ts": "// parseCount is mentioned here only in a comment\nexport const msg = \"call parseCount() first\";\nexport const tip = `parseCount ${1}`;\n",
    "src/shadow.ts": "export function useLocal() {\n  const parseCount = 1;\n  return parseCount;\n}\n",
    "src/index.ts": "export { parseCount as countFrom } from \"./core\";\nexport * from \"./more\";\nexport { default as Writer } from \"./writer\";\n",
    "src/more.ts": "export function extra(): number {\n  return 1;\n}\n",
    "src/writer.ts": "export default class TextWriter {\n  write(s: string) {\n    return s;\n  }\n}\n",
    "src/use-default.ts": "import W from \"./writer\";\nexport const w = new W();\n",
    "src/use-named-wrong.ts": "import { TextWriter } from \"./writer\";\nexport const bad = TextWriter;\n",
    "src/use-barrel.ts": "import { countFrom, Writer } from \"./index\";\nexport const n = countFrom(\"2\");\nexport const w2 = new Writer();\n",
    "src/generated-x.ts": "export function parseCount() { return 0; }\n",
    "src/long.ts": `export const big = "${"x".repeat(1500)} LONGMARK";\n`,
    "test/core.test.ts": "import { parseCount } from \"../src/core\";\nif (parseCount(\"1\") !== 1) throw new Error(\"x\");\n",
    "test/barrel.test.ts": "import { countFrom } from \"../src\";\nif (countFrom(\"1\") !== 1) throw new Error(\"x\");\n",
    "test/more.test.ts": "export const placeholder = 1;\n",
    "dist/core.d.ts": "export declare function parseCount(s: string): number;\n",
    "build/core.js": "export function parseCount() {}\n",
    "keep.log": "kept by negation\n",
    "app.log": "ignored log\n",
    ".env": "SECRET=do-not-read\n",
    "secret-root.txt": "anchored ignore\n",
    "nested/secret-root.txt": "not anchored here\n",
    ".git/config": "[core]\n",
    ".git/HEAD": "ref: refs/heads/main\n",
  };
  for (const [p, c] of Object.entries(files)) put(root, p, c);
  put(root, "bin.dat", Buffer.from([0x70, 0x61, 0x72, 0x73, 0x65, 0x43, 0x6f, 0x75, 0x6e, 0x74, 0x00, 0x01, 0x02]));
  put(outside, "secret.txt", "OUTSIDE-SECRET parseCount\n");
  put(outside, "evil.gitignore", "*.test.ts\n");
  symlinkSync(outside, join(root, "link-out"));
  symlinkSync(join(outside, "secret.txt"), join(root, "src/link-file.ts"));
  symlinkSync(join(root, ".git"), join(root, "gitlink"));
  symlinkSync(join(outside, "evil.gitignore"), join(root, "test/.gitignore"));
}

export interface Ctx { base: string; isWhat: string; cbw: string; near: string; outside: string }

export function setup(): Ctx {
  const base = mkdtempSync(join(tmpdir(), "peaceai-m143-"));
  const ctx: Ctx = { base, isWhat: join(base, "is-what"), cbw: join(base, "code-block-writer"), near: join(base, "near"), outside: join(base, "outside") };
  unpack(BUNDLES.isWhat.file, ctx.isWhat);
  unpack(BUNDLES.cbw.file, ctx.cbw);
  buildNearMiss(ctx.near, ctx.outside);
  return ctx;
}

export function teardown(ctx: Ctx) {
  rmSync(ctx.base, { recursive: true, force: true });
}

/** sha256 + size + mtime of every file and link under dir (links not followed): proves nothing was written. */
export function snapshot(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, n.name);
      const st = statSync(p, { throwIfNoEntry: false });
      if (n.isDirectory()) { out.push(`d ${relative(dir, p)}`); walk(p); }
      else if (n.isSymbolicLink()) out.push(`l ${relative(dir, p)}`);
      else out.push(`f ${relative(dir, p)} ${st?.size} ${st?.mtimeMs} ${createHash("sha256").update(readFileSync(p)).digest("hex")}`);
    }
  };
  walk(dir);
  return out.join("\n");
}
