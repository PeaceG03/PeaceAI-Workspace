#!/bin/bash
# grade.sh <task> : apply the dry-run edit to the stocks worktree, run the new test, the full suite and all typechecks, then reset.
set -u
k=$1; S=/workspace/v4-cov/stocks; O=/workspace/v4-cov/out/$k; cd $S
git reset -q --hard origin/main; git clean -fdq -e node_modules
python3 - "$O/1.json" "$S" <<'P'
import json,sys,os
d=json.load(open(sys.argv[1]))['edit']; S=sys.argv[2]
for e in [d]+d.get('extra',[]):
  open(os.path.join(S,e['path']),'w').write(e['content'])
print('applied',d['path'],[x['path'] for x in d.get('extra',[])])
P
t=$(git status --porcelain | awk '$1=="??"{print $2}')
git diff --stat; echo "new test: $t"
npx tsx --test $t 2>&1 | grep -E "^# (pass|fail)"
git stash -q -- $(git diff --name-only); echo "-- at base:"; npx tsx --test $t 2>&1 | grep -E "^# (pass|fail)"; git stash pop -q
npx tsx --test src/*.test.ts > /tmp/suite-$k.log 2>&1; grep -E "^# (tests|pass|fail)" /tmp/suite-$k.log | tr '\n' ' '; echo
for s in typecheck typecheck:scanner typecheck:lib typecheck:worker; do pnpm -s run $s >/dev/null 2>&1 && echo -n "$s ok; " || echo -n "$s FAIL; "; done; echo
git diff > $O/candidate.diff; git diff --no-index /dev/null $t >> $O/candidate.diff
git reset -q --hard origin/main; git clean -fdq -e node_modules
