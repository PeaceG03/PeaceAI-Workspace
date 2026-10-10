// M6: run after esbuild in build-kernel.sh. Usage: kernel-guard.ts <bundle.cjs> <meta.json>. Exit 1 on any violation.
import { readFileSync } from "node:fs";
import { checkKernelBundle } from "../lib/kernelguard.ts";

const [bundlePath, metaPath] = process.argv.slice(2);
if (!bundlePath || !metaPath) {
  console.error("usage: kernel-guard.ts <bundle> <metafile>");
  process.exit(2);
}
const result = checkKernelBundle(readFileSync(bundlePath, "utf8"), JSON.parse(readFileSync(metaPath, "utf8")));
for (const v of result.violations) console.error(`kernel-guard: ${v}`);
console.log(`kernel guard ${result.ok ? "passed" : "FAILED"}: inputs=${result.inputs} violations=${result.violations.length}`);
process.exit(result.ok ? 0 : 1);
