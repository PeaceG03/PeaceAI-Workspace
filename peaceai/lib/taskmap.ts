// Maps issue text to a small set of synthesis request variants for the native kernel.
import { taskRequiresTests } from "./policy.ts";

export const MAX_OBJECTIVE_CHARS = 2000;

export interface TaskInput {
  title: string;
  body: string;
}

export interface RequestVariant {
  objective: string;
  targetPath: string;
}

/** True when the HTML comment at [at, end) sits inside one inline code span (`...`) on its own line (Auditor #377 note:
 *  code spans only; a comment in plain prose or a bare quote is still hidden Markdown and removed). */
/** Private-use placeholder for a template literal's backtick while the Markdown backticks are stripped. */
const TEMPLATE_TICK = "\uE000";

export function insideCodeSpan(all: string, at: number, end: number): boolean {
  const lineStart = all.lastIndexOf("\n", at - 1) + 1;
  const nl = all.indexOf("\n", end);
  const before = all.slice(lineStart, at), after = all.slice(end, nl < 0 ? all.length : nl);
  return (before.split("\x60").length - 1) % 2 === 1 && after.includes("\x60");
}

export function cleanIssueText(input: TaskInput): string {
  const text = `${input.title}\n\n${input.body}`
    // Stress v1 (M2): an HTML comment is hidden Markdown, except inside an inline code span on its line
    // (e.g. `'<!-- key: a -->'`); that one is task data and is kept verbatim (Auditor #377: code spans only).
    .replace(/<!--[\s\S]*?-->/g, (m, at: number, all: string) => (!m.includes("\n") && insideCodeSpan(all, at, at + m.length) ? m : " "))
    // M5: target routing lines are not part of the task.
    .replace(/^[ \t]*target:[ \t]*\S+[ \t]*$/gim, " ")
    .replace(/```[\s\S]*?```/g, " ")
    // M46: a leading ">" is a Markdown quote marker; every other ">" is kept so comparison operators survive
    // (>, >=, and the > of =>). <, <=, ===, !== were never touched. Backticks and "#" are still dropped; "*" too, except below.
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, "")
    // Live proof #304: a binary "*" between spaces (`a * b`) is code, not Markdown emphasis or a bullet; keep it.
    // M85 (stress C4): a backtick span holding a `${...}` substitution on one line is a template literal (code), not
    // Markdown: its backticks are kept (TEMPLATE_TICK placeholder) while every other backtick is dropped.
    .replace(/\uE000/g, " ")
    .replace(/`[^`\n]*\$\{[^`\n]*`/g, (m) => m.replaceAll("`", TEMPLATE_TICK))
    .replace(/[`#]|(?<!\S )\*|\*(?! )/g, " ")
    .replaceAll(TEMPLATE_TICK, "`")
    // Markdown emphasis underscores only; identifiers such as MAX_ITEMS keep theirs.
    .replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, " ")
    .replace(/[ \t]+/g, " ")
    // Live proof #307: a stripped trailing backtick must not leave a space before the line end (`$` triggers).
    .replace(/ +$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, MAX_OBJECTIVE_CHARS);
}

/** Source files named in the issue (e.g. "src/text.ts"), restricted to known workspace sources. */
export function mentionedTargets(objective: string, sourcePaths: readonly string[]): string[] {
  const mentioned = new Set(objective.match(/\bsrc\/[A-Za-z0-9._/-]+\.ts\b/g) ?? []);
  return sourcePaths.filter((path) => mentioned.has(path));
}

export function buildVariants(
  input: TaskInput,
  sourcePaths: readonly string[],
  isTest: (path: string) => boolean = (path) => path.endsWith(".test.ts"),
  preferred: readonly string[] = [],
): RequestVariant[] {
  const objective = cleanIssueText(input);
  if (!objective) return [];
  const owners = sourcePaths.filter((path) => !isTest(path));
  const named = mentionedTargets(objective, owners);
  // Named owners first, then owners the symbol index resolved (M6), then the rest as alternatives.
  const first = [...named, ...preferred.filter((path) => owners.includes(path) && !named.includes(path))];
  const targets = [...first, ...owners.filter((path) => !first.includes(path))];
  const phrasings = new Set<string>([objective]);
  // When the task asks for tests, never spend budget on a phrasing that drops them.
  if (!taskRequiresTests(objective)) phrasings.add(`${objective.replace(/\.?\s*$/, "")}, with focused tests.`);
  const variants: RequestVariant[] = [];
  for (const targetPath of targets) for (const phrasing of phrasings) variants.push({ objective: phrasing, targetPath });
  return variants;
}
