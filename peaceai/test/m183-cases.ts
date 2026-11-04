// M183 behavior cases (batch 20) for repair-v2's inherited-member localisation (peaceai/lib/editpropose.ts baseOf /
// ownerOf, used by M182's memberSites). As data so m183-mutation.test.ts can replay the pure cases against each mutant.
// Each case throws (node:assert) on failure. Admitted on three unrelated class shapes (an instance method one
// `extends` step up called through `this`, a getter two steps up read through `this`, a static method of the base called
// through the subclass's own name), each a fault in a base-class member the request does not name, so no site located
// before M183 holds the fix; every m183 guard has a refused near miss; every proposal of the admits is checked against
// the loop's M175 gate (in-body, by M182's admit helper). Fixtures are tiny synthetic repos written for these tests from
// general shapes (vehicles, shapes, a paged feed, small near-miss classes): none is modeled on a dev-split task's code or
// on a reference diff, and none is a PeaceSTOCKS shape. The end-to-end case (needsCand) runs the real loop and needs
// M183_CAND (no fallback user). Spec: peaceai/spec/repair-v2-m183.md.
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
import { admit, members, sitesOf, type Case, type Check } from "./m182-cases.ts";

export { setup, teardown, type Ctx, type Case } from "./m182-cases.ts";

// The end-to-end case runs ONLY as the candidate uid named by M183_CAND; with none set it asserts the fail-closed
// CAND_UID_* refusal. It never falls back to another batch's candidate user.
const M183_CAND = process.env.M183_CAND ?? "";
export const m183Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M183_CAND }).ok;
const MAX_ATTEMPTS = loop.MAX_ATTEMPTS;

// ---- fixtures (synthetic, general shapes)
// A: an instance method one step up, called through `this`: a truck orders its base's tire count minus the spares
const VEHICLE = "export class Vehicle {\n  wheels: number;\n  constructor(wheels: number) {\n    this.wheels = wheels;\n  }\n  tires(spares: number): number {\n    return this.wheels - spares;\n  }\n}\nexport class Truck extends Vehicle {\n  constructor() {\n    super(6);\n  }\n  order(fleet: number): number {\n    return fleet * this.tires(1);\n  }\n}\n";
const VEHICLES = { "src/vehicle.ts": VEHICLE };
const VEHICLE_REQ = "`order` asks for too few tires.";
const VEHICLE_CHECKS: Check[] = [(x) => new x.Truck().order(1) === 7, (x) => new x.Truck().order(2) === 14, (x) => new x.Truck().order(0) === 0, (x) => new x.Vehicle(4).tires(0) === 4];
// B: a getter two steps up, read through `this`: the perimeter divides the side count by the size
const SHAPE = "export class Shape {\n  sides: number;\n  size: number;\n  constructor(sides: number, size: number) {\n    this.sides = sides;\n    this.size = size;\n  }\n  get perimeter(): number {\n    return this.sides / this.size;\n  }\n}\nexport class Polygon extends Shape {\n  title(): string {\n    return `${this.sides}-gon`;\n  }\n}\nexport class Square extends Polygon {\n  constructor(size: number) {\n    super(4, size);\n  }\n  fence(posts: number): number {\n    return this.perimeter + posts;\n  }\n}\n";
const SHAPES = { "src/shape.ts": SHAPE };
const SHAPE_REQ = "`fence` needs more wire than it says.";
const SHAPE_CHECKS: Check[] = [(x) => new x.Square(3).fence(0) === 12, (x) => new x.Square(5).fence(2) === 22, (x) => new x.Square(1).fence(1) === 5, (x) => new x.Square(2).title() === "4-gon"];
// C: a static method of the base called through the subclass's own name: 1-based pages are offset one page too far
const FEED = "export class Pager {\n  static offset(page: number, size: number): number {\n    return (page + 1) * size;\n  }\n}\nexport class Feed extends Pager {\n  static slice(items: string[], page: number): string[] {\n    const start = Feed.offset(page, 2);\n    return items.slice(start, start + 2);\n  }\n}\n";
const FEEDS = { "src/feed.ts": FEED };
const FEED_REQ = "`slice` skips the first page.";
const five = ["a", "b", "c", "d", "e"];
const FEED_CHECKS: Check[] = [(x) => x.Feed.slice(five, 1).join(",") === "a,b", (x) => x.Feed.slice(five, 2).join(",") === "c,d", (x) => x.Feed.slice(five, 3).join(",") === "e", (x) => x.Feed.slice(five, 4).join(",") === ""];

const ADMITS = [[VEHICLES, VEHICLE_REQ], [SHAPES, SHAPE_REQ], [FEEDS, FEED_REQ]] as const;

export const CASES: Case[] = [
  // ---- admits: three unrelated class shapes, each a fault in a base-class member the request does not name
  admit("admit (an inherited method called through this, one extends step): Truck.order -> this.tires() declared in Vehicle; the spare sign is fixed in the base", VEHICLES, VEHICLE_REQ, "src/vehicle.ts", VEHICLE_CHECKS, ["tires"], /return this\.wheels \+ spares;/),
  admit("admit (an inherited getter read through this, two extends steps): Square.fence reads this.perimeter declared in Shape; the operator is fixed in the getter", SHAPES, SHAPE_REQ, "src/shape.ts", SHAPE_CHECKS, ["perimeter"], /return this\.sides \* this\.size;/),
  admit("admit (an inherited static called through the subclass's own name): Feed.slice -> Feed.offset declared in Pager; the page sign is fixed in the base", FEEDS, FEED_REQ, "src/feed.ts", FEED_CHECKS, ["offset"], /return \(page - 1\) \* size;/),
  {
    id: "order and v1: inherited member sites are tier 4 after every other site, the earlier sites are unchanged, and repair-v1 locates none",
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
    id: "super: `super.m()` resolves in the base even when the own class overrides m; `this.m()` there is the override (m183-guard:ih-super)",
    run(l, ctx) {
      const t = "export class Note {\n  text: string;\n  constructor(text: string) {\n    this.text = text;\n  }\n  describe(): string {\n    return this.text.trim();\n  }\n}\nexport class Todo extends Note {\n  describe(): string {\n    return `[ ] ${this.text}`;\n  }\n  summary(): string {\n    return super.describe() + \" / \" + this.describe();\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/todo.ts": t }, "`summary` is wrong."), ["describe@6", "describe@11"]);
      const arrow = "export class Note {\n  describe(): string {\n    return \"n\";\n  }\n}\nexport class Todo extends Note {\n  all(xs: string[]): string[] {\n    return xs.map(() => super.describe());\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/todo.ts": arrow }, "`all` is wrong."), ["describe@2"], "an arrow keeps super");
      const noBase = 'import { Note } from "./note.ts";\nexport class Todo extends Note {\n  summary(): string {\n    return super.describe();\n  }\n}\n';
      assert.deepEqual(members(l, ctx, { "src/note.ts": "export class Note {\n  describe(): string {\n    return \"n\";\n  }\n}\n", "src/todo.ts": noBase }, "`summary` is wrong."), [], "an imported base is not resolved");
    },
  },
  // ---- near misses, one per guard / condition
  {
    id: "near miss (m183-guard:ih-extends): a class that only `implements` another class inherits nothing from it; the same with `extends` does",
    run(l, ctx) {
      const t = (kw: string) => `export class Rule {\n  limit(): number {\n    return 3;\n  }\n}\nexport class Lane ${kw} Rule {\n  fits(n: number): boolean {\n    return n < this.limit();\n  }\n}\n`;
      assert.deepEqual(members(l, ctx, { "src/lane.ts": t("implements") }, "`fits` is wrong."), []);
      assert.deepEqual(members(l, ctx, { "src/lane.ts": t("extends") }, "`fits` is wrong."), ["limit@2"]);
    },
  },
  {
    id: "near miss (m183-guard:ih-nearest): the nearest declaration wins; a data field or an override in a middle class shadows the base's method",
    run(l, ctx) {
      const t = (mid: string) => `export class Base {\n  fee(): number {\n    return 1;\n  }\n}\nexport class Mid extends Base {\n${mid}}\nexport class Kid extends Mid {\n  total(n: number): number {\n    return n + this.fee();\n  }\n}\n`;
      assert.deepEqual(members(l, ctx, { "src/fee.ts": t("") }, "`total` is wrong."), ["fee@2"]);
      assert.deepEqual(members(l, ctx, { "src/fee.ts": t("  fee = 2;\n") }, "`total` is wrong."), [], "a data field shadows the method (mc-kind refuses it)");
      assert.deepEqual(members(l, ctx, { "src/fee.ts": t("  fee(): number {\n    return 2;\n  }\n") }, "`total` is wrong."), ["fee@7"], "the override, not the base");
      // static and instance names are separate: a static `fee` in Kid does not shadow the inherited instance method
      const s = "export class Base {\n  fee(): number {\n    return 1;\n  }\n}\nexport class Kid extends Base {\n  static fee(): number {\n    return 0;\n  }\n  total(n: number): number {\n    return n + this.fee();\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/fee.ts": s }, "`total` is wrong."), ["fee@2"]);
    },
  },
  {
    id: "near miss (m183-guard:ih-private): a #private name is never looked up in a base (it is lexically scoped); in its own class it is",
    run(l, ctx) {
      const t = "export class Base {\n  #seed(): number {\n    return 7;\n  }\n  first(): number {\n    return this.#seed();\n  }\n}\nexport class Kid extends Base {\n  next(): number {\n    return this.#seed() + 1;\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/seed.ts": t }, "`next` is wrong."), []);
      assert.deepEqual(members(l, ctx, { "src/seed.ts": t }, "`first` is wrong."), ["#seed@2"]);
    },
  },
  {
    id: "near miss (m183-guard:ih-depth): at most MAX_BASE_DEPTH extends steps; a cyclic chain (broken code) ends",
    run(l, ctx) {
      assert.equal(l.prop.MAX_BASE_DEPTH, 3);
      const chain = "export class L0 {\n  root(): number {\n    return 0;\n  }\n}\nexport class L1 extends L0 {}\nexport class L2 extends L1 {}\nexport class L3 extends L2 {\n  three(): number {\n    return this.root();\n  }\n}\nexport class L4 extends L3 {\n  four(): number {\n    return this.root();\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/chain.ts": chain }, "`three` is wrong."), ["root@2"]);
      assert.deepEqual(members(l, ctx, { "src/chain.ts": chain }, "`four` is wrong."), []);
      const cyc = "export class A extends B {\n  go(): number {\n    return this.nope();\n  }\n}\nexport class B extends A {}\n";
      assert.deepEqual(members(l, ctx, { "src/cyc.ts": cyc }, "`go` is wrong."), []);
    },
  },
  {
    id: "limits: a mixin call or a property-access base is not resolved; an inherited member inside a located class is not added; inherited sites share MAX_MEMBER_SITES",
    run(l, ctx) {
      const base = "export class Base {\n  helper(): number {\n    return 1;\n  }\n}\n";
      const mixin = base + "const mix = (C: typeof Base) => C;\nexport class Kid extends mix(Base) {\n  run(): number {\n    return this.helper();\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/kid.ts": mixin }, "`run` is wrong."), []);
      const ns = base + "const ns = { Base };\nexport class Kid extends ns.Base {\n  run(): number {\n    return this.helper();\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/kid.ts": ns }, "`run` is wrong."), []);
      const plain = base + "export class Kid extends Base {\n  run(): number {\n    return this.helper();\n  }\n}\n";
      assert.deepEqual(members(l, ctx, { "src/kid.ts": plain }, "`run` and `Base` are wrong."), []);
      const names = ["ka", "kb", "kc", "kd", "ke"];
      const many = `export class Steps {\n${names.map((x, i) => `  ${x}(): number {\n    return ${i + 1};\n  }\n`).join("")}}\nexport class Go extends Steps {\n  go(): number {\n    return ${names.map((x) => `this.${x}()`).join(" + ")};\n  }\n}\n`;
      assert.deepEqual(members(l, ctx, { "src/steps.ts": many }, "`go` is wrong."), ["ka@2", "kb@5", "kc@8", "kd@11"]);
    },
  },
  // ---- end to end (candidate uid): the real loop with repair-v2 fixes fixture A within the attempt budget
  {
    id: "loop e2e: repair-v2 locates Vehicle.tires through Truck's this and fixes it; the row is a valid PASS with editScope in-body",
    needsCand: true,
    run() {
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m183-e2e-"));
      try {
        const ctx = { m151, scratch };
        const test = 'import assert from "node:assert/strict";\nimport { Truck, Vehicle } from "../src/vehicle.ts";\n\ntest("one truck", () => assert.equal(new Truck().order(1), 7));\ntest("two trucks", () => assert.equal(new Truck().order(2), 14));\ntest("no trucks", () => assert.equal(new Truck().order(0), 0));\ntest("car, no spares", () => assert.equal(new Vehicle(4).tires(0), 4));\n';
        const task = { ...e2eTask(ctx, `m183-truck-${Date.now() % 100000}`, VEHICLES, test), request: VEHICLE_REQ };
        const r = loop.runLoopTask(task as never, "public", "a".repeat(64), { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, MAX_ATTEMPTS), env: { ...m151.env, [STAGE2_CAND_ENV]: M183_CAND } } as never);
        assert.equal(loopRowProblem(r.row), null, `row valid (${loopRowProblem(r.row)})`);
        if (!m183Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
        assert.equal(r.row.code, "PASS", `codes ${JSON.stringify(r.row.attemptCodes)}`);
        assert.equal((r.row as LoopRow).editScope, "in-body");
        assert.ok(r.row.attempts! >= 1 && r.row.attempts! <= MAX_ATTEMPTS, `attempts ${r.row.attempts}`);
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
];
