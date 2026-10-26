// M114 (public-derive-from-behavior-v5, string parsing): the HELD-OUT specs, recorded and pushed BEFORE the v5
// engine (peaceai/lib/derive-string.ts) existed or ran on anything. They are not used to build the engine. Each is
// written the way an issue author would: a header, a reference function (the behavior the author means) and the
// example inputs they would list first; the expected outputs are the reference function's. `asked` is empty here:
// rows the engine asks for on the first run are added later, in m114-derive-string-parsing.test.ts, never here.
// Shapes: reading back a health check-in line `part|status|note` (and a few neighbours: `part|age`, a `#` comment
// line, a path's last segment, a comma list). Names are this file's own; nothing names a PeaceSTOCKS function.
export type HeldArg = string | number;
export interface HeldSpec { fn: string; sig: string; ret: "string" | "number" | "boolean" | "string[]"; f: (...a: never[]) => unknown; examples: HeldArg[][] }

export const HELD_OUT: readonly HeldSpec[] = [
  {
    fn: "partOf", sig: "line: string", ret: "string",
    f: (line: string) => (line.split("|")[0] ?? "").trim(),
    examples: [["scan|ok|fine"], [" r2 | late | x"], ["tenmin"], ["|ok|"], ["daily|error|disk full"], ["  scan  "]],
  },
  {
    fn: "statusOf", sig: "line: string", ret: "string",
    f: (line: string) => { const v = line.split("|")[1]; return v === undefined ? "unknown" : v.trim(); },
    examples: [["scan|ok|fine"], ["r2| late |"], ["tenmin"], ["daily|error|disk full"], ["scan"], ["r2|ok"]],
  },
  {
    fn: "noteOf", sig: "line: string", ret: "string",
    f: (line: string) => { const p = line.split("|"); return p.length > 2 ? p.slice(2).join("|") : ""; },
    examples: [["scan|ok|took 12s"], ["r2|error|a|b"], ["tenmin|ok"], ["daily|ok|"], ["scan"], ["r2|late|slow|again|x"]],
  },
  {
    fn: "fieldCount", sig: "line: string", ret: "number",
    f: (line: string) => line.split("|").length,
    examples: [["a|b|c"], ["a"], [""], ["a||"], ["scan|ok|fine|x"], ["|"]],
  },
  {
    fn: "ageOf", sig: "line: string", ret: "number",
    f: (line: string) => { const v = line.split("|")[1] ?? ""; return /^-?\d{1,12}$/.test(v) ? Number(v) : -1; },
    examples: [["scan|12"], ["r2|0"], ["tenmin|x"], ["daily|"], ["daily"], ["scan|-3"], ["r2|45"], ["tenmin|12x"]],
  },
  {
    fn: "isErrorLine", sig: "line: string", ret: "boolean",
    f: (line: string) => (line.split("|")[1] ?? "").trim() === "error",
    examples: [["scan|error|disk"], ["r2|ok|"], ["tenmin| error |x"], ["daily|late|error"], ["error"], ["scan|errors|"], ["r2|error"], ["daily|ok|error"]],
  },
  {
    fn: "stripPartPrefix", sig: "line: string", ret: "string",
    f: (line: string) => (line.startsWith("part:") ? line.slice(5) : line),
    examples: [["part:scan"], ["part:r2"], ["scan"], ["r2"], ["part:"], ["tenmin"]],
  },
  {
    fn: "hasTag", sig: "line: string, tag: string", ret: "boolean",
    f: (line: string, tag: string) => line.includes(tag),
    examples: [["scan|ok|#slow", "#slow"], ["r2|ok|", "#slow"], ["tenmin|late|#retry #slow", "#retry"], ["daily|ok|x", "#retry"], ["scan|ok|#slowly", "#slow"], ["r2|late|retry", "#retry"]],
  },
  {
    fn: "fieldAt", sig: "line: string, n: number", ret: "string",
    f: (line: string, n: number) => line.split("|")[n] ?? "",
    examples: [["scan|ok|fine", 0], ["scan|ok|fine", 1], ["scan|ok|fine", 2], ["scan|ok|fine", 3], ["r2|late", 1], ["r2|late", 2], ["tenmin", 0], ["tenmin", 1]],
  },
  {
    fn: "isComment", sig: "line: string", ret: "boolean",
    f: (line: string) => line.trim().startsWith("#"),
    examples: [["# note"], ["  # indented"], ["scan|ok"], ["r2|ok|# not"], [""], ["#"], ["x#"]],
  },
  {
    fn: "lastSegment", sig: "path: string", ret: "string",
    f: (path: string) => path.slice(path.lastIndexOf("/") + 1),
    examples: [["src/a/b.ts"], ["b.ts"], ["src/"], ["a/b"], ["/x"], ["dir/sub/file.json"]],
  },
  {
    fn: "listItems", sig: "text: string", ret: "string[]",
    f: (text: string) => text.split(",").map((x) => x.trim()),
    examples: [["a, b, c"], ["scan"], [" r2 ,tenmin"], [""], ["x,,y"]],
  },
];
