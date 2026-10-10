// Parses a /verdict comment passed through COMMENT_BODY. Outputs ok=true|false only.
import { appendFileSync } from "node:fs";
import { parseVerdict } from "../lib/verdict.ts";

const parsed = parseVerdict(process.env.COMMENT_BODY ?? "");
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=${parsed.ok}\n`);
console.log(parsed.ok ? "verdict command ok" : "verdict command rejected");
