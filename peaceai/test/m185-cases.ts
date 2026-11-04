// M185 behavior cases (batch 21) for repair-v2's imported-base localisation (peaceai/lib/editpropose.ts importedClass,
// used by M183's baseOf / ownerOf inside M182's memberSites). As data so m185-mutation.test.ts can replay the pure cases
// against each mutant. Each case throws (node:assert) on failure. Admitted on three unrelated class shapes (a method of a
// base imported by name, a getter of a base reached through an `export *` folder index, a static of a base two steps up
// where the first step is a default import and the second resolves in the base's own file), each a fault in a base
// member in another file that the request does not name, so no site located before M185 holds the fix; every
// condition has a refused near miss; every proposal of the admits is checked against the loop's M175 gate (in-body, by
// M184's admitAt helper). Fixtures are tiny synthetic repos written for these tests from general shapes (an alarm
// clock, a game sprite, a running log, small near-miss classes): none is modeled on a dev-split task's code or on a
// reference diff, and none is a PeaceSTOCKS shape. The end-to-end case (needsCand) runs the real loop and needs
// M185_CAND (no fallback user). Spec: peaceai/spec/repair-v2-m185.md.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repairProposer } from "../lib/editpropose.ts"; // the e2e case runs the real (unmutated) proposer
import * as loop from "../lib/loop.ts";
import type * as Loop from "../lib/loop.ts";
import { loopRowProblem, type LoopRow } from "../lib/looprow.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";
import { e2eTask, opts as opts174 } from "./m174-cases.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";
import { admitAt, sitesOf, type Case, type Check, type Files, type Libs, type Ctx } from "./m184-cases.ts";

export { setup, teardown, type Ctx, type Case } from "./m184-cases.ts";

const M185_CAND = process.env.M185_CAND ?? "";
export const m185Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M185_CAND }).ok;
const MAX_ATTEMPTS = loop.MAX_ATTEMPTS;
const admit = admitAt(4);
/** The tier-4 (member) sites as "name@path:line" (1-based line of the member's start in its own file). */
export const inherited = (l: Libs, ctx: Ctx, files: Files, request: string): string[] =>
  sitesOf(l, ctx, files, request).filter((s) => s.tier === 4).map((s) => `${s.name}@${s.path}:${files[s.path]!.slice(0, s.start).split("\n").length}`);

// ---- fixtures (synthetic, general shapes)
// A: a method of a base imported by name, called through `this`: the clock adds the start instead of subtracting it
export const ALARM: Files = {
  "src/alarm.ts": 'import { Clock } from "./clock.ts";\n\nexport class Alarm extends Clock {\n  ring(now: number): boolean {\n    return this.elapsed(now) >= 10;\n  }\n}\n',
  "src/clock.ts": "export class Clock {\n  start: number;\n  constructor(start: number) {\n    this.start = start;\n  }\n  elapsed(now: number): number {\n    return now + this.start;\n  }\n}\n",
};
export const ALARM_REQ = "`ring` goes off at the wrong time.";
export const ALARM_CHECKS: Check[] = [(x) => new x.Alarm(5).ring(15) === true, (x) => new x.Alarm(5).ring(14) === false, (x) => new x.Alarm(2).elapsed(3) === 1, (x) => new x.Alarm(0).ring(10) === true];
// B: a getter of a base reached through a folder index with `export *`: the sprite's right edge subtracts its width
const SPRITE: Files = {
  "src/player.ts": 'import { Sprite } from "./gfx/index.ts";\n\nexport class Player extends Sprite {\n  hits(x: number): boolean {\n    return x < this.right;\n  }\n}\n',
  "src/gfx/index.ts": 'export * from "./color.ts";\nexport * from "./sprite.ts";\n',
  "src/gfx/color.ts": "export function dim(c: number): number {\n  return c >> 1;\n}\n",
  "src/gfx/sprite.ts": "export class Sprite {\n  x: number;\n  w: number;\n  constructor(x: number, w: number) {\n    this.x = x;\n    this.w = w;\n  }\n  get right(): number {\n    return this.x - this.w;\n  }\n}\n",
};
const SPRITE_REQ = "`hits` misses things it touches.";
const SPRITE_CHECKS: Check[] = [(x) => new x.Player(2, 3).hits(4) === true, (x) => new x.Player(2, 3).hits(5) === false, (x) => new x.Player(0, 1).hits(0) === true, (x) => new x.Player(1, 1).hits(3) === false];
// C: a static two steps up: Run extends the default-imported Log, which extends Units in its own file; km multiplies
const RUNLOG: Files = {
  "src/run.ts": 'import Log from "./log.ts";\n\nexport class Run extends Log {\n  static pace(meters: number, minutes: number): number {\n    return minutes / Run.km(meters);\n  }\n}\n',
  "src/log.ts": 'export class Units {\n  static km(m: number): number {\n    return m * 1000;\n  }\n}\nexport default class Log extends Units {\n  static label(): string {\n    return "log";\n  }\n}\n',
};
const RUNLOG_REQ = "`pace` is far too small.";
const RUNLOG_CHECKS: Check[] = [(x) => x.Run.pace(5000, 25) === 5, (x) => x.Run.pace(1000, 6) === 6, (x) => x.Run.pace(2000, 10) === 5, (x) => x.Run.label() === "log"];

const ADMITS = [[ALARM, ALARM_REQ], [SPRITE, SPRITE_REQ], [RUNLOG, RUNLOG_REQ]] as const;
const RUN = "`run` is wrong.";
const BASE = "export class Base {\n  helper(): number {\n    return 1;\n  }\n}\n";
const kid = (imp: string, kw = "extends") => `${imp}\nexport class Kid ${kw} Base {\n  run(): number {\n    return this.helper() + 1;\n  }\n}\n`;

export const CASES: Case[] = [
  // ---- admits: three unrelated class shapes, each a fault in a base member in another file
  admit("admit (a base imported by name, one step): Alarm.ring -> this.elapsed() declared in Clock (src/clock.ts); the start sign is fixed in the base", ALARM, ALARM_REQ, "src/alarm.ts", ALARM_CHECKS, ["elapsed@src/clock.ts"], /return now - this\.start;/),
  admit("admit (a base reached through an `export *` folder index): Player.hits reads this.right declared in Sprite (src/gfx/sprite.ts); the width sign is fixed in the getter", SPRITE, SPRITE_REQ, "src/player.ts", SPRITE_CHECKS, ["right@src/gfx/sprite.ts"], /return this\.x \+ this\.w;/),
  admit("admit (a default-imported base whose own base is in its file, two steps): Run.pace -> Run.km declared in Units (src/log.ts); the unit factor is fixed", RUNLOG, RUNLOG_REQ, "src/run.ts", RUNLOG_CHECKS, ["km@src/log.ts"], /return m \/ 1000;/),
  {
    id: "order and v1: imported-base member sites are tier 4 after every other site, the earlier sites are unchanged, and repair-v1 locates none",
    run(l, ctx) {
      for (const [files, req] of ADMITS) {
        const sites = sitesOf(l, ctx, files, req);
        const at = sites.findIndex((s) => s.tier === 4);
        assert.ok(at > 0);
        assert.ok(sites.slice(at).every((s) => s.tier === 4));
        const v1 = sitesOf(l, ctx, files, req, l.prop.CALLEE_DEPTH.v1);
        assert.deepEqual(sites.slice(0, v1.length), v1);
        assert.deepEqual(v1.filter((s) => s.tier === 4), []);
      }
    },
  },
  {
    id: "scope: an imported base's own `extends` resolves in the base's file, not in the subclass's file (a same-named class there is ignored)",
    run(l, ctx) {
      const files: Files = {
        "src/kid.ts": 'import { Mid } from "./mid.ts";\n\nclass Root {\n  ping(): number {\n    return 0;\n  }\n}\nexport const local = new Root();\nexport class Kid extends Mid {\n  run(): number {\n    return this.ping();\n  }\n}\n',
        "src/mid.ts": 'import { Root } from "./root.ts";\n\nexport class Mid extends Root {}\n',
        "src/root.ts": "export class Root {\n  ping(): number {\n    return 1;\n  }\n}\n",
      };
      assert.deepEqual(inherited(l, ctx, files, RUN), ["ping@src/root.ts:2"]);
      // `super.m()` starts at the imported base too
      const sup: Files = { "src/base.ts": BASE, "src/kid.ts": 'import { Base } from "./base.ts";\nexport class Kid extends Base {\n  helper(): number {\n    return 5;\n  }\n  twice(): number {\n    return super.helper() * 2 + this.helper();\n  }\n}\n' };
      assert.deepEqual(inherited(l, ctx, sup, "`twice` is wrong."), ["helper@src/base.ts:2", "helper@src/kid.ts:3"]);
    },
  },
  // ---- near misses, one per condition
  {
    id: "near miss (m185-guard:xb-allowed): a base declared in a vendored or generated file is not a site; the same base in a plain source file is",
    run(l, ctx) {
      assert.deepEqual(inherited(l, ctx, { "vendor/base.ts": BASE, "src/kid.ts": kid('import { Base } from "../vendor/base.ts";') }, RUN), []);
      assert.deepEqual(inherited(l, ctx, { "src/dist/base.ts": BASE, "src/kid.ts": kid('import { Base } from "./dist/base.ts";') }, RUN), []);
      assert.deepEqual(inherited(l, ctx, { "lib/base.ts": BASE, "src/kid.ts": kid('import { Base } from "../lib/base.ts";') }, RUN), ["helper@lib/base.ts:2"]);
    },
  },
  {
    id: "near miss (m184-guard:rx-exported, class): a class the module does not export is not the import's target; the exported one is",
    run(l, ctx) {
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": BASE.replace("export class", "class") + "export const x = 1;\n", "src/kid.ts": kid('import { Base } from "./base.ts";') }, RUN), []);
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": BASE.replace("export class", "class") + "export { Base };\n", "src/kid.ts": kid('import { Base } from "./base.ts";') }, RUN), ["helper@src/base.ts:2"], "a local export list exports it");
    },
  },
  {
    id: "near miss (m186-guard:dx-not-named, class): `export default class Base` is not a named export Base; a default import of it is followed",
    run(l, ctx) {
      const def = BASE.replace("export class", "export default class");
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": def, "src/kid.ts": kid('import { Base } from "./base.ts";') }, RUN), []);
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": def, "src/kid.ts": kid('import Base from "./base.ts";') }, RUN), ["helper@src/base.ts:2"]);
    },
  },
  {
    id: "near miss (m183-guard:ih-extends, imported): a class that only `implements` an imported class inherits nothing from it",
    run(l, ctx) {
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": BASE, "src/kid.ts": kid('import { Base } from "./base.ts";', "implements") }, RUN), []);
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": BASE, "src/kid.ts": kid('import { Base } from "./base.ts";') }, RUN), ["helper@src/base.ts:2"]);
    },
  },
  {
    id: "near miss (m172-guard:imp-type-only / imp-type-only-name, imported base): a type-only import binds no class; an alias import is followed under its imported name",
    run(l, ctx) {
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": BASE, "src/kid.ts": kid('import type { Base } from "./base.ts";') }, RUN), []);
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": BASE, "src/kid.ts": kid('import { type Base } from "./base.ts";') }, RUN), []);
      const alias = 'import { Model as Base } from "./model.ts";';
      assert.deepEqual(inherited(l, ctx, { "src/model.ts": BASE.replace("class Base", "class Model"), "src/kid.ts": kid(alias) }, RUN), ["helper@src/model.ts:2"]);
    },
  },
  {
    id: "near miss (barrel rules for classes: rx-type-only, rx-star-unique, rx-named-first): type-only and ambiguous star re-exports are not followed; a named re-export wins",
    run(l, ctx) {
      const other = "export class Base {\n  helper(): number {\n    return 2;\n  }\n}\n";
      const imp = kid('import { Base } from "./m/index.ts";');
      assert.deepEqual(inherited(l, ctx, { "src/m/a.ts": BASE, "src/m/index.ts": 'export type * from "./a.ts";\n', "src/kid.ts": imp }, RUN), []);
      assert.deepEqual(inherited(l, ctx, { "src/m/a.ts": BASE, "src/m/index.ts": 'export type { Base } from "./a.ts";\n', "src/kid.ts": imp }, RUN), []);
      assert.deepEqual(inherited(l, ctx, { "src/m/a.ts": BASE, "src/m/b.ts": other, "src/m/index.ts": 'export * from "./a.ts";\nexport * from "./b.ts";\n', "src/kid.ts": imp }, RUN), []);
      assert.deepEqual(inherited(l, ctx, { "src/m/a.ts": BASE, "src/m/b.ts": other, "src/m/index.ts": 'export * from "./a.ts";\nexport { Base } from "./b.ts";\n', "src/kid.ts": imp }, RUN), ["helper@src/m/b.ts:2"]);
    },
  },
  {
    id: "near miss (m184-guard:rx-hops, class): a base behind 3 re-export steps is followed, behind 4 it is not",
    run(l, ctx) {
      const chain = (n: number): Files => {
        const f: Files = { "src/kid.ts": kid('import { Base } from "./b0.ts";'), [`src/b${n}.ts`]: BASE };
        for (let i = 0; i < n; i++) f[`src/b${i}.ts`] = `export { Base } from "./b${i + 1}.ts";\n`;
        return f;
      };
      assert.deepEqual(inherited(l, ctx, chain(3), RUN), ["helper@src/b3.ts:2"]);
      assert.deepEqual(inherited(l, ctx, chain(4), RUN), []);
    },
  },
  {
    id: "near miss (m183-guard:ih-depth, across files): a member 3 extends steps up through imported bases is followed, 4 steps up is not; a cross-file cycle stops",
    run(l, ctx) {
      const tower = (n: number): Files => {
        const f: Files = { "src/kid.ts": 'import { C1 } from "./c1.ts";\nexport class Kid extends C1 {\n  run(): number {\n    return this.helper() + 1;\n  }\n}\n' };
        for (let i = 1; i < n; i++) f[`src/c${i}.ts`] = `import { C${i + 1} } from "./c${i + 1}.ts";\nexport class C${i} extends C${i + 1} {}\n`;
        f[`src/c${n}.ts`] = `export class C${n} {\n  helper(): number {\n    return 1;\n  }\n}\n`;
        return f;
      };
      assert.deepEqual(inherited(l, ctx, tower(3), RUN), ["helper@src/c3.ts:2"]);
      assert.deepEqual(inherited(l, ctx, tower(4), RUN), []);
      const cyc: Files = {
        "src/a.ts": 'import { B } from "./b.ts";\nexport class A extends B {}\n',
        "src/b.ts": 'import { A } from "./a.ts";\nexport class B extends A {}\n',
        "src/kid.ts": 'import { A } from "./a.ts";\nexport class Kid extends A {\n  run(): number {\n    return this.helper();\n  }\n}\n',
      };
      assert.deepEqual(inherited(l, ctx, cyc, RUN), []);
    },
  },
  {
    id: "limits: a non-relative base, a namespace-import base, a static call through an imported class and a member already located are not added",
    run(l, ctx) {
      assert.deepEqual(inherited(l, ctx, { "src/kid.ts": kid('import { Base } from "base-pkg";') }, RUN), []);
      const ns = 'import * as m from "./base.ts";\nexport class Kid extends m.Base {\n  run(): number {\n    return this.helper() + 1;\n  }\n}\n';
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": BASE, "src/kid.ts": ns }, RUN), []);
      const stat = 'import { Base } from "./base.ts";\nexport class Kid {\n  run(): number {\n    return Base.make();\n  }\n}\n';
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": "export class Base {\n  static make(): number {\n    return 1;\n  }\n}\n", "src/kid.ts": stat }, RUN), []);
      // the request names the base member itself: it is located (tier 0) and not added again as a member site
      assert.deepEqual(inherited(l, ctx, { "src/base.ts": BASE, "src/kid.ts": kid('import { Base } from "./base.ts";') }, "`run` and `helper` are wrong."), []);
    },
  },
  // ---- end to end (candidate uid): the real loop with repair-v2 fixes fixture A within the attempt budget
  {
    id: "loop e2e: repair-v2 locates Clock.elapsed through Alarm's imported base and fixes it; the row is a valid PASS with editScope in-body",
    needsCand: true,
    run() {
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m185-e2e-"));
      try {
        const ctx = { m151, scratch };
        const test = 'import assert from "node:assert/strict";\nimport { Alarm } from "../src/alarm.ts";\nimport { Clock } from "../src/clock.ts";\n\ntest("rings at ten", () => assert.equal(new Alarm(5).ring(15), true));\ntest("quiet at nine", () => assert.equal(new Alarm(5).ring(14), false));\ntest("elapsed", () => assert.equal(new Clock(2).elapsed(3), 1));\ntest("from zero", () => assert.equal(new Alarm(0).ring(10), true));\n';
        const task = { ...e2eTask(ctx, `m185-alarm-${Date.now() % 100000}`, ALARM, test), request: ALARM_REQ };
        const r = loop.runLoopTask(task as never, "public", "a".repeat(64), { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, MAX_ATTEMPTS), env: { ...m151.env, [STAGE2_CAND_ENV]: M185_CAND } } as never);
        assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
        if (!m185Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
        assert.equal(r.row.code, "PASS", `codes ${JSON.stringify(r.row.attemptCodes)}`);
        assert.equal((r.row as LoopRow).editScope, "in-body");
        assert.ok(r.row.attempts! >= 1 && r.row.attempts! <= MAX_ATTEMPTS, `attempts ${r.row.attempts}`);
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
];
