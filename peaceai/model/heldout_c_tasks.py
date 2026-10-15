"""M44 set C v2 task rule (deterministic, committed before any grading). See peaceai/model/heldout-c-tasks.json."""
import json, re, subprocess, sys
C = json.load(open(sys.argv[1]))["sets"]["C"]; HIST = sys.argv[2]
TEST = re.compile(r"(\.test\.|\.spec\.|(^|/)tests?/|(^|/)__tests__/)"); CODE = re.compile(r"\.(ts|tsx|js|mjs|cjs)$")
out = []
for e in sorted(C, key=lambda x: x["repo"]):
    d = f"{HIST}/{e['repo'].replace('/', '__')}"
    revs = subprocess.run(["git", "-C", d, "rev-list", "--no-merges", "--first-parent", "-n", "400", e["sha"]], capture_output=True, text=True, check=True).stdout.split()
    picked = []
    for c in revs:
        if len(picked) == 3: break
        ns = subprocess.run(["git", "-C", d, "diff-tree", "--no-commit-id", "-r", "--name-status", "--no-renames", f"{c}^", c], capture_output=True, text=True).stdout.strip().split("\n")
        rows = [l.split("\t") for l in ns if l]
        if len(rows) != 2 or any(r[0] not in ("A", "M") for r in rows): continue
        paths = [r[1] for r in rows]
        if not all(CODE.search(p) and not p.endswith(".d.ts") for p in paths): continue
        tests = [p for p in paths if TEST.search(p)]; srcs = [p for p in paths if not TEST.search(p)]
        if len(tests) != 1 or len(srcs) != 1: continue
        picked.append({"repo": e["repo"], "sha": c, "pinned": e["sha"], "src": srcs[0], "test": tests[0]})
    out += picked
print(json.dumps({"schema": "peaceai-heldout-c-tasks:v1", "tasks": out}, indent=1))
