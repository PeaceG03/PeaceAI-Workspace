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

/** True when offset `at` is inside a '...' or "..." literal opened earlier on the same line (no escapes counted). */
export function insideQuote(all: string, at: number): boolean {
  const line = all.slice(all.lastIndexOf("\n", at - 1) + 1, at);
  let q: string | null = null;
  for (const c of line) if (q) { if (c === q) q = null; } else if (c === "'" || c === '"') q = c;
  return q !== null;
}

export function cleanIssueText(input: TaskInput): string {
  const text = `${input.title}\n\n${input.body}`
    // Stress v1 (M2): an HTML comment is hidden Markdown, except when it sits inside a quoted literal on its line
    // (e.g. an expected value '<!-- key: a -->'); that one is task data and is kept verbatim.
    .replace(/<!--[\s\S]*?-->/g, (m, at: number, all: string) => (insideQuote(all, at) && !m.includes("\n") ? m : " "))
    // M5: target routing lines are not part of the task.
    .replace(/^[ \t]*target:[ \t]*\S+[ \t]*$/gim, " ")
    .replace(/```[\s\S]*?```/g, " ")
    // M46: a leading ">" is a Markdown quote marker; every other ">" is kept so comparison operators survive
    // (>, >=, and the > of =>). <, <=, ===, !== were never touched. Backticks and "#" are still dropped; "*" too, except below.
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, "")
    // Live proof #304: a binary "*" between spaces (`a * b`) is code, not Markdown emphasis or a bullet; keep it.
    .replace(/[`#]|(?<!\S )\*|\*(?! )/g, " ")
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
