"""M119: box generator for the LM retrain data commit list (peaceai/model/lm-retrain-commits.txt). Public data only.

Usage: retrain_list.py --since 2026-10-16T00:00:00Z --ws-prs WS.json --ps-prs PS.json --ws DIR --ps DIR --out FILE
  WS.json / PS.json: `gh pr list --state merged --search "merged:>=<day>" --json number,headRefOid,mergeCommit,mergedAt,headRefName`
  DIR: full (non-shallow) clones whose origin/main holds every merge commit.
Selection (earned truth only; Auditor's retrain gate item 4):
  code lines: PRs merged into main at or after --since. Each PR is used ONLY as its merge commit's first-parent diff,
    i.e. the exact content Auditor passed and that was merged with --match-head-commit; the branch's own commits
    (earlier, NOT-PASS rounds) are never walked. Workspace: every merged PR except peaceai-approve-rule/* (lander-merged
    rule approvals, not Auditor-passed code heads) and builder-log/* (their rows are taken row by row below).
    PeaceSTOCKS: merged peace-task/* PRs only (the verdict PRs: Peace's /verdict, Auditor byte-checked). A merge commit
    with 2 parents must have the PR head as its second parent.
  row lines: builder-log/tasks.jsonl rows that were added in a main
    commit at or after --since (the row's own date may be earlier: catch-up rows), are byte-identical on main today to
    the text they were added with (never edited, so never un-credited), and are not in COVERAGE_NONE_SEQS (the
    retro-grandfathered coverage:none rows).
Output: one line per item, sorted; its sha256 is what the workflow pins. Prints counts only."""
import argparse, hashlib, json, re, subprocess, sys

ap = argparse.ArgumentParser()
for a in ("--since", "--ws-prs", "--ps-prs", "--ws", "--ps", "--out"):
    ap.add_argument(a, required=True)
args = ap.parse_args()
WS, PS = "PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"
COVERAGE_NONE_SEQS = {97, 99, 101}  # builder-log/check.ts
HEX = re.compile(r"[0-9a-f]{40}")


def git(d, *a):
    return subprocess.run(["git", "-C", d, *a], capture_output=True, text=True, check=True).stdout


def code_lines(repo, d, prs, keep):
    out, skipped = [], {}
    main = set(git(d, "rev-list", "--first-parent", "origin/main").split())
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
        out.append(f"code {repo} #{p['number']} head={head} merge={merge}")
    return out, skipped


ws_prs, ps_prs = json.load(open(args.ws_prs)), json.load(open(args.ps_prs))
ws, ws_skip = code_lines(WS, args.ws, ws_prs, lambda p: "approve-rule" if p["headRefName"].startswith("peaceai-approve-rule/") else "builder-log" if p["headRefName"].startswith("builder-log/") else None)
ps, ps_skip = code_lines(PS, args.ps, ps_prs, lambda p: None if p["headRefName"].startswith("peace-task/") else "not-verdict")

P = "builder-log/tasks.jsonl"
main_sha = git(args.ws, "rev-parse", "origin/main").strip()


def rows(sha):
    try:
        t = git(args.ws, "show", f"{sha}:{P}")
    except subprocess.CalledProcessError:
        return {}, []
    lines = t.split("\n")
    return {json.loads(l)["seq"]: (i + 1, l) for i, l in enumerate(lines) if l.strip()}, lines


commits = [c for c in git(args.ws, "log", "--first-parent", "--reverse", f"--since={args.since}", "--format=%H", "origin/main", "--", P).split() if c]
base, _ = rows(commits[0] + "^") if commits else ({}, [])
first = {}
for c in commits:
    for s, (_, l) in rows(c)[0].items():
        if s not in base and s not in first:
            first[s] = (c, l)
now, _ = rows(main_sha)
row_lines, row_skip = [], {}
for s in sorted(first):
    c, l = first[s]
    why = None
    if s not in now or now[s][1] != l:
        why = "edited-or-removed"
    elif s in COVERAGE_NONE_SEQS:
        why = "coverage-none-grandfathered"
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
