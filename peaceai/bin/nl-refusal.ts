// M10: writes the "parser was unsure" comment. Its only inputs are two enums from Job A (the refusal code and
// a family name); anything else fails. The body is fixed text plus the static phrasing list, and it still
// passes the leak scanner before it is written. No task text and no code ever reach it.
import { writeFileSync } from "node:fs";
import { FAMILIES, isRefusal, refusalComment, type Family } from "../lib/nlparse.ts";
import { parseTerms, scanText } from "../lib/leak.ts";

const reason = String(process.env.NL_REASON ?? "");
const hintRaw = String(process.env.NL_HINT ?? "");
const out = process.env.PEACEAI_BODY_FILE;
if (!out || !isRefusal(reason)) { console.log("nl-refusal: invalid reason; nothing written"); process.exit(1); }
const hint = (FAMILIES as readonly string[]).includes(hintRaw) ? (hintRaw as Family) : null;
if (hintRaw && !hint) { console.log("nl-refusal: invalid hint; nothing written"); process.exit(1); }
const body = refusalComment(reason, hint);
const findings = scanText(body, parseTerms(process.env.PEACEAI_PRIVATE_TERMS));
if (findings.length > 0) { console.log(`nl-refusal: leak scan failed (${findings.length}); nothing written`); process.exit(1); }
writeFileSync(out, body + "\n");
console.log(`nl-refusal reason=${reason} hint=${hint ?? "none"} bytes=${Buffer.byteLength(body)}`);
