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

export function cleanIssueText(input: TaskInput): string {
  const text = `${input.title}\n\n${input.body}`
    .replace(/<!--[\s\S]*?-->/g, " ")
    // M5: target routing lines are not part of the task.
    .replace(/^[ \t]*target:[ \t]*\S+[ \t]*$/gim, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*>#]/g, " ")
    // Markdown emphasis underscores only; identifiers such as MAX_ITEMS keep theirs.
    .replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, " ")
    .replace(/[ \t]+/g, " ")
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
): RequestVariant[] {
  const objective = cleanIssueText(input);
  if (!objective) return [];
  const owners = sourcePaths.filter((path) => !isTest(path));
  const named = mentionedTargets(objective, owners);
  // Named owners first, then the remaining owners as alternative placements.
  const targets = [...named, ...owners.filter((path) => !named.includes(path))];
  const phrasings = new Set<string>([objective]);
  // When the task asks for tests, never spend budget on a phrasing that drops them.
  if (!taskRequiresTests(objective)) phrasings.add(`${objective.replace(/\.?\s*$/, "")}, with focused tests.`);
  const variants: RequestVariant[] = [];
  for (const targetPath of targets) for (const phrasing of phrasings) variants.push({ objective: phrasing, targetPath });
  return variants;
}
