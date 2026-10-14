// M31: narrows an lm-corpus.ts output (PEACEAI_LM_IN) to the public allowlist minus held-out, into PEACEAI_LM_OUT.
// Prints counts only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { heldOutHashes } from "../lib/lmcorpus.ts";
import { scanText } from "../lib/leak.ts";
import { filterPublic, validAllow, type PublicManifestEntry } from "../lib/lmpublic.ts";

const inDir = resolve(process.env.PEACEAI_LM_IN ?? ""), outDir = resolve(process.env.PEACEAI_LM_OUT ?? "");
const allow = validAllow(JSON.parse(readFileSync(resolve(import.meta.dirname, "../model/lm-public-allow.json"), "utf8")));
if (!allow) { console.log("lm-public-corpus refused=allowlist-invalid"); process.exit(1); }
const heldOut = heldOutHashes(JSON.parse(readFileSync(resolve(import.meta.dirname, "../model/heldout.json"), "utf8")));
const lines = (f: string) => readFileSync(join(inDir, f), "utf8").split("\n").filter(Boolean);
const r = filterPublic(lines("manifest.jsonl").map((l) => JSON.parse(l) as PublicManifestEntry), lines("docs.jsonl"), heldOut, allow);
// Leak check (personal info, secrets) on every kept document; counts only, never text or paths.
let leaks = 0;
for (const d of r.docs) leaks += scanText((JSON.parse(d) as { text: string }).text, []).length;
if (leaks) { console.log(`lm-public-corpus refused=leak findings=${leaks}`); process.exit(1); }
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "manifest.jsonl"), r.manifest.map((m) => JSON.stringify(m)).join("\n") + "\n");
writeFileSync(join(outDir, "docs.jsonl"), r.docs.join("\n") + "\n");
console.log(`lm-public-corpus files=${r.manifest.length} dropped=${r.dropped} allowlist=${allow.sha256.length}`);
