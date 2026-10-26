"""M119: box generator for the LM retrain data commit list (peaceai/model/lm-retrain-commits.txt). Public data only.

Usage: retrain_list.py --since 2026-10-16T00:00:00Z --ws-prs WS.json --ps-prs PS.json --ws DIR --ps DIR --out FILE
         [--ws-main SHA] [--ps-main SHA]   (default origin/main; the list pins the heads in lm-retrain.json)
  WS.json / PS.json: `gh pr list --state merged --search "merged:>=<day>" --json number,headRefOid,mergeCommit,mergedAt,headRefName`
  DIR: full (non-shallow) clones whose origin/main holds every merge commit.
Selection (earned truth only; Auditor's retrain gate item 4):
  code lines: PRs merged into main at or after --since. Each PR is used ONLY as its merge commit's first-parent diff,
    i.e. the exact content Auditor passed and that was merged with --match-head-commit; the branch's own commits
    (earlier, NOT-PASS rounds) are never walked. A squash/rebase (1-parent) merge is kept only when every file it
    changes has the same blob at refs/pull/N/head (the listed head); otherwise the PR is skipped. Workspace: every merged PR except peaceai-approve-rule/* (lander-merged
    rule approvals, not Auditor-passed code heads) and builder-log/* (their rows are taken row by row below).
    PeaceSTOCKS: merged peace-task/* PRs only (the verdict PRs: Peace's /verdict, Auditor byte-checked). A merge commit
    with 2 parents must have the PR head as its second parent.
  row lines: builder-log/tasks.jsonl rows that were added in a main
    commit at or after --since (the row's own date may be earlier: catch-up rows), are byte-identical on main today to
    the text they were added with (never edited, so never un-credited), are not no-credit rows (builder-log/check.ts
    isCoverageNone: "coverage":"none" or the grandfathered COVERAGE_NONE_SEQS) and are not retags (check.ts
    retagTarget !== null: a retag is not a task). Both predicates are imported from check.ts itself (tsx), never copied.
Output: one line per item, sorted; its sha256 is what the workflow pins. Prints counts only."""
import argparse, hashlib, json, re, subprocess, sys

ap = argparse.ArgumentParser()
for a in ("--since", "--ws-prs", "--ps-prs", "--ws", "--ps", "--out"):
    ap.add_argument(a, required=True)
ap.add_argument("--ws-main", default="origin/main")
ap.add_argument("--ps-main", default="origin/main")
args = ap.parse_args()
WS, PS = "PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"
HERE = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
REPO = __import__("os").path.dirname(__import__("os").path.dirname(HERE))
# No-credit and retag seqs, decided by builder-log/check.ts's own isCoverageNone / retagTarget (not a copy).
NO_CREDIT_TS = """
import { readFileSync } from "node:fs";
import { isCoverageNone, retagTarget } from "./builder-log/check.ts";
const rows = readFileSync(0, "utf8").split("\\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
console.log(JSON.stringify({ coverageNone: rows.filter((e) => isCoverageNone(e)).map((e) => e.seq),
  retag: rows.filter((e) => retagTarget(e) !== null).map((e) => e.seq) }));
"""


def no_credit(text):
    r = subprocess.run([__import__("os").path.join(REPO, "node_modules/.bin/tsx"), "--eval", NO_CREDIT_TS], cwd=REPO, input=text,
                       capture_output=True, text=True, check=True)
    o = json.loads(r.stdout)
    return set(o["coverageNone"]), set(o["retag"])
HEX = re.compile(r"[0-9a-f]{40}")


def git(d, *a):
    return subprocess.run(["git", "-C", d, *a], capture_output=True, text=True, check=True).stdout


def same_as_head(d, n, head, parent, merge):
    """Squash/rebase merge: refs/pull/N/head is the head, and every file the merge changes has the head's blob
    (peaceai/bin/lm-retrain-headcheck.sh re-checks this in CI, fail closed)."""
    git(d, "fetch", "--quiet", "origin", f"+refs/pull/{n}/head:refs/m119/pull/{n}")
    if git(d, "rev-parse", f"refs/m119/pull/{n}").strip() != head:
        return False
    blob = lambda c, f: subprocess.run(["git", "-C", d, "rev-parse", "--verify", "--quiet", f"{c}:{f}"], capture_output=True, text=True).stdout.strip() or "absent"  # noqa: E731
    files = [f for f in git(d, "diff-tree", "-z", "--no-commit-id", "--name-only", "-r", "--no-renames", parent, merge).split("\0") if f]
    return all(blob(merge, f) == blob(head, f) for f in files)


def code_lines(repo, d, prs, keep, ref):
    out, skipped = [], {}
    main = set(git(d, "rev-list", "--first-parent", ref).split())
    for p in prs:
        why = keep(p)
        if why:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        if p["mergedAt"] < args.since:
            continue
        head, merge = p["headRefOid"], (p.get("mergeCommit") or {}).get("oid", "")
        if not HEX.fullmatch(head) or not HEX.fullmatch(merge) or merge not in main:
            sys.exit(f"retrain_list: {repo}#{p['number']} merge commit not on main's first-parent line")
        parents = git(d, "show", "-s", "--format=%P", merge).split()
        if len(parents) == 2 and parents[1] != head:
            sys.exit(f"retrain_list: {repo}#{p['number']} merge's second parent is not the PR head")
        if len(parents) not in (1, 2):
            sys.exit(f"retrain_list: {repo}#{p['number']} merge commit has {len(parents)} parents")
        if len(parents) == 1 and not same_as_head(d, p["number"], head, parents[0], merge):
            skipped["merged-content-differs-from-head"] = skipped.get("merged-content-differs-from-head", 0) + 1
            continue
        out.append(f"code {repo} #{p['number']} head={head} merge={merge}")
    return out, skipped


ws_prs, ps_prs = json.load(open(args.ws_prs)), json.load(open(args.ps_prs))
ws, ws_skip = code_lines(WS, args.ws, ws_prs, lambda p: "approve-rule" if p["headRefName"].startswith("peaceai-approve-rule/") else "builder-log" if p["headRefName"].startswith("builder-log/") else None, args.ws_main)
ps, ps_skip = code_lines(PS, args.ps, ps_prs, lambda p: None if p["headRefName"].startswith("peace-task/") else "not-verdict", args.ps_main)

P = "builder-log/tasks.jsonl"
main_sha = git(args.ws, "rev-parse", args.ws_main).strip()


def rows(sha):
    try:
        t = git(args.ws, "show", f"{sha}:{P}")
    except subprocess.CalledProcessError:
        return {}, []
    lines = t.split("\n")
    return {json.loads(l)["seq"]: (i + 1, l) for i, l in enumerate(lines) if l.strip()}, lines


commits = [c for c in git(args.ws, "log", "--first-parent", "--reverse", f"--since={args.since}", "--format=%H", main_sha, "--", P).split() if c]
base, _ = rows(commits[0] + "^") if commits else ({}, [])
first = {}
for c in commits:
    for s, (_, l) in rows(c)[0].items():
        if s not in base and s not in first:
            first[s] = (c, l)
now, _ = rows(main_sha)
coverage_none, retags = no_credit(git(args.ws, "show", f"{main_sha}:{P}"))
row_lines, row_skip = [], {}
for s in sorted(first):
    c, l = first[s]
    why = None
    if s not in now or now[s][1] != l:
        why = "edited-or-removed"
    elif s in retags:
        why = "retag-not-a-task"
    elif s in coverage_none:
        why = "coverage-none"
    if why:
        row_skip[why] = row_skip.get(why, 0) + 1
        continue
    row_lines.append(f"row {WS} {P} seq={s} line={now[s][0]} at={main_sha} added={c}")
num = lambda l: int(l.split(" #", 1)[1].split(" ", 1)[0])
lines = sorted(ws, key=num) + sorted(ps, key=num) + row_lines
text = "\n".join(lines) + "\n"
open(args.out, "w").write(text)
print(json.dumps({"workspacePRs": len(ws), "workspaceSkipped": ws_skip, "peacestocksPRs": len(ps), "peacestocksSkipped": ps_skip,
                  "builderLogRows": len(row_lines), "rowsSkipped": row_skip, "sha256": hashlib.sha256(text.encode()).hexdigest()}))
