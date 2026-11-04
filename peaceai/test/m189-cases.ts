// M189 behavior cases (batch 23) for repair-v2's candidate cap (peaceai/lib/editpropose.ts reachReserved, spec:
// peaceai/spec/repair-v2-m189.md). Before M189 the 60-candidate cap was filled in template order across all sites, so a
// located function with many operators could fill it alone and push out every candidate at a reach site (M182 class
// members, M184 / M186 barrel and default re-exports; Auditor's batch-22 note). Admitted on two synthetic shapes (a
// scoring function + a class member, a pricing function + a barrel-resolved helper), with near misses for each guard;
// repair-v1 (and so model-v1's scoring list) is unchanged. Pure: no candidate uid, no network, no task shape.
import assert from "node:assert/strict";
import type * as Prop from "../lib/editpropose.ts";

export interface Libs { prop: typeof Prop }
export interface Case { id: string; run: (l: Libs) => void }
type Site = Prop.Site;

const BIG = "export function score(a: number, b: number, c: number): number {\n" + Array.from({ length: 30 }, (_, i) => `  if (a > ${i} && b < ${i + 1}) c = c + a * ${i} - b;\n`).join("") + "  return c;\n}\n";
/** Few comparisons, many arithmetic edits: the reach site's comparison candidates fall between located ones. */
const MIXED = "export function score(a: number, b: number, c: number): number {\n" + Array.from({ length: 4 }, (_, i) => `  if (a > ${i}) c = c - b;\n`).join("") + Array.from({ length: 40 }, (_, i) => `  c = c + a * ${i} - b / ${i + 1};\n`).join("") + "  return c;\n}\n";
const SMALL = "export function score(a: number, b: number): number {\n  return a > b ? a - b : b - a;\n}\n";
const GAUGE = "export class Gauge {\n  level(x: number): number {\n    return x > 3 ? x - 1 : x + 1;\n  }\n}\n";
const PRICE = "export function price(qty: number, unit: number): number {\n" + Array.from({ length: 24 }, (_, i) => `  if (qty >= ${i * 5} || unit <= ${i}) unit = unit * ${i + 2} + qty;\n`).join("") + "  return qty * unit;\n}\n";
const ROUND = "export function roundCents(v: number): number {\n  return v < 0 ? Math.ceil(v * 100 - 0.5) / 100 : Math.floor(v * 100 + 0.5) / 100;\n}\n";

const siteOf = (path: string, text: string, name: string, from: string, to: string, tier = 0): Site => {
  const start = text.indexOf(from), end = text.lastIndexOf(to) + to.length;
  assert.ok(start >= 0 && end > start, `site ${name}`);
  return { path, name, start, end, tier };
};
function shape(which: "gauge" | "barrel", big = true, mixed = false) {
  if (which === "gauge") {
    const main = mixed ? MIXED : big ? BIG : SMALL;
    const files = new Map([["src/score.ts", main], ["src/gauge.ts", GAUGE]]);
    return { files, sites: [siteOf("src/score.ts", main, "score", "export function", "}\n"), siteOf("src/gauge.ts", GAUGE, "level", "level(", "  }\n")].map((s, i) => (i === 1 ? { ...s, tier: 4 } : { ...s, tier: 0 })) };
  }
  const main = big ? PRICE : SMALL;
  const files = new Map([["src/price.ts", main], ["src/util/round.ts", ROUND]]);
  return { files, sites: [siteOf("src/price.ts", main, big ? "price" : "score", "export function", "}\n"), { ...siteOf("src/util/round.ts", ROUND, "roundCents", "export function", "}\n"), tier: 5 }].map((s, i) => (i === 0 ? { ...s, tier: 0 } : s)) };
}
/** The same sites with reach tiers mapped to 3 (a located-side tier no template looks at): the plain fixed-order walk. */
const plain = (sites: readonly Site[]): Site[] => sites.map((s) => (s.tier >= 4 ? { ...s, tier: 3 } : s));
const reachCount = (q: Prop.Candidate[]) => q.filter((c) => c.muts.some((m) => m.site === 1)).length;
const keys = (q: Prop.Candidate[]) => q.map((c) => c.key);

export const CASES: Case[] = [
  {
    id: "admit: when the located site alone fills the cap, reach-site candidates keep REACH_RESERVED slots (class member, barrel helper)",
    run({ prop }) {
      assert.equal(prop.REACH_TIER, 4);
      assert.equal(prop.REACH_RESERVED, 12);
      for (const which of ["gauge", "barrel"] as const) {
        const { files, sites } = shape(which);
        const before = prop.repairCandidates(plain(sites), files, new Set(), true);
        assert.equal(before.length, prop.MAX_CANDIDATES, `${which}: the cap binds`);
        assert.equal(reachCount(before), 0, `${which}: without M189 the reach site gets nothing`);
        const alone = prop.repairCandidates([sites[1]!], files, new Set(), true);
        assert.ok(alone.length > 0);
        const seen = new Set<string>();
        const q = prop.repairCandidates(sites, files, seen, true);
        assert.equal(q.length, prop.MAX_CANDIDATES, which);
        assert.equal(reachCount(q), Math.min(prop.REACH_RESERVED, alone.length), `${which}: reach candidates kept`);
        const located = q.filter((c) => c.muts.every((m) => m.site === 0));
        assert.deepEqual(keys(located), keys(before).slice(0, located.length), `${which}: the located side keeps its own first candidates`);
        assert.deepEqual([...seen].sort(), keys(q).sort(), `${which}: seen holds exactly the kept keys`);
      }
    },
  },
  {
    id: "order: the kept candidates stay in the walk's template order (reach candidates of an early template come before later located ones)",
    run({ prop }) {
      for (const which of ["gauge", "barrel"] as const) {
        const { files, sites } = shape(which, true, which === "gauge");
        const q = prop.repairCandidates(sites, files, new Set(), true);
        assert.equal(q.length, prop.MAX_CANDIDATES, `${which}: the cap binds`);
        const rank = (c: Prop.Candidate) => prop.TEMPLATES_V2.indexOf(c.muts[0]!.template);
        for (let i = 1; i < q.length; i++) assert.ok(rank(q[i - 1]!) < rank(q[i]!) || (rank(q[i - 1]!) === rank(q[i]!) && q[i - 1]!.muts[0]!.site <= q[i]!.muts[0]!.site), `${which}: position ${i}`);
        const firstReach = q.findIndex((c) => c.muts[0]!.site === 1);
        const lastLocated = q.length - 1 - [...q].reverse().findIndex((c) => c.muts[0]!.site === 0);
        assert.ok(firstReach >= 0, `${which}: reach kept`);
        if (which === "gauge") assert.ok(firstReach < lastLocated, "gauge: interleaved, not appended");
      }
    },
  },
  {
    id: "unchanged: repair-v1 (model-v1's scoring list), a cap that does not bind, and no reach site give the plain walk",
    run({ prop }) {
      for (const which of ["gauge", "barrel"] as const) {
        const big = shape(which);
        const v1 = prop.repairCandidates(big.sites, big.files, new Set(), false);
        assert.deepEqual(keys(v1), keys(prop.repairCandidates(plain(big.sites), big.files, new Set(), false)), `${which}: repair-v1 is unchanged`);
        assert.equal(reachCount(v1), 0, `${which}: repair-v1 still fills the cap from the located site`);
        const small = shape(which, false);
        const q = prop.repairCandidates(small.sites, small.files, new Set(), true);
        assert.ok(q.length < prop.MAX_CANDIDATES, `${which}: small`);
        assert.deepEqual(keys(q), keys(prop.repairCandidates(plain(small.sites), small.files, new Set(), true)), `${which}: no binding cap, no change`);
        const onlyLocated = prop.repairCandidates([big.sites[0]!], big.files, new Set(), true);
        assert.equal(onlyLocated.length, prop.MAX_CANDIDATES, `${which}: no reach site`);
        // a key already seen (e.g. the M178 rebuild's tried keys) is skipped on both sides
        const seen = new Set(keys(prop.repairCandidates([big.sites[1]!], big.files, new Set(), true)));
        assert.equal(reachCount(prop.repairCandidates(big.sites, big.files, seen, true)), 0, `${which}: seen reach keys are not re-queued`);
      }
    },
  },
];
