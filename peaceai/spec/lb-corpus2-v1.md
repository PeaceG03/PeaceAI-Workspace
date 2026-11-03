# lb-corpus v2 (limit-breaker chain 2: data only) - v1

Status: BUILT AND PUBLISHED, NOT CLEARED, NOT TRAINABLE. This change builds data. It runs no training, dispatches
nothing, adds no workflow and does not touch lb-train.json, latest.json, Results or R2.

## Decision up front: chain 2 warm-starts from chain 1's final save

- Chain 2 is a NEW lb-daily chain. Its chainId is the run id of its first dispatch, never chain 1's 41222155935, and
  its R2 folder is lb-daily/<that id>/. Its corpus pins are the new v2 pins below, not chain 1's.
- Warm start: chain 1's save-000006000, whose manifest sha256 is
  1e513e5080e23453d4ca5b33911567a8958f5873503fd6b869f0fb5dd3ea2cd6. Before any chain-2 training, the restored
  save's manifest sha256 must equal both this pin (peaceai/model/lb-corpus2.json chain2.warmStart) and the one in the
  day-3 Results row runs/lb-daily/2026-11-03-41572356445.json (Results commit 80b0c35, Auditor-VALID). A mismatch
  refuses.
- That check, the chain-2 workflow input and a full-model init path in train.py are NOT in this PR. Today
  --init-from is LoRA-only and --resume-from refuses a new DATA_SHA. A later reviewed PR adds them, with any
  workflow input defaulting to OFF / no-run. chain2.enabled is false here, and m180 asserts it.
- Training on v2 needs: (1) Auditor's hidden near-dup check of the published pins = 0, (2) an add-only
  lb-train.json clearedCorpora entry for exactly these pins, and (3) that later PR. Until then nothing can train
  on v2. m180 asserts that the v2 pins are not in clearedCorpora and that no workflow names the builder.

## What v2 is

v2 is the chain-1 cleaned corpus VERBATIM, plus new owner content appended after it.

- The chain-1 corpus has docs 7eb6c628, manifest e9f78828 and fingerprint a3e9165f, built at b149d9b. It is copied
  byte-for-byte, so its train/heldout split, and with it the held-out eval of days 1-3, is unchanged.
- The new content comes from PeaceAI-Workspace main and is attributable to Auditor-PASSed pull requests only.

Code:
- peaceai/lib/lbcorpus2.ts holds the pure rules.
- peaceai/bin/lb-corpus2.ts does the git and file I/O.
- Both extend lb-clean rather than adding a second framework. Every new file goes through lbclean.ts clean()
  unchanged: junk, task-set by name and by public refs, split, dedup, --drop-hashes, difficulty and FIM, with the
  committed lb-clean.json.

## Source rule (condition 1), conservative

A file of the sources tip tree (d70bf9ac7cf3e4e50c732c7976531fe0af18a559, main after #671) is admitted if and only
if ALL of the following hold:

1. Every commit that touched its path (`git log --no-renames --full-history <tip> -- <path>`) is the squash merge on
   main of a PR in the passed list. The bin checks that each listed merge is single-parent, that its subject ends in
   "(#N)", and that it is an ancestor of the tip. A path with any other commit in its history is not attributable
   and is excluded, even if a passed PR also touched it.
2. Its extension is code or text: ts mts cts js mjs cjs py sh md.
3. Its path is not junk (lb-clean JUNK_PATH), is not under a fixture(s)/ directory, is not under .github/, and does
   not match /hidden|held-?out|results|taskset|tasks-|exclusion|drop-hash|nl-pairs|verdict/i.
4. Its text holds no run of 40 to 64 hex characters (a pinned commit, blob or content hash) and is valid UTF-8.

Exclusions:
- Results-repo content is not admitted, and no Results row is read.
- Peace's own verdicts live in Results, so none are admitted in v1.
- Nothing hidden-adjacent is admitted.

License: "owner:PeaceG03". The Workspace has no LICENSE file. This follows the existing owner-repo precedent in
sources.json and ext-manifest. Auditor (#673): owner-authored code is fine and needs no LICENSE, because the model stays
private.

Passed PRs: each PASS is at the exact head that was merged. Full shas are in peaceai/model/lb-corpus2.json.

| PR | squash merge | passed head | evidence |
|----|--------------|-------------|----------|
| #665 | 777bf1d | d0ab904 | Auditor review record, PASS at d0ab904 |
| #666 | 7abc445 | 4516a24 | Auditor review record, PASS at 4516a243 |
| #667 | c8bf9c6 | 328eafd | Auditor review record, PASS at 328eafd |
| #668 | e6b8aec | acfd606 | Auditor review record, PASS at acfd606 |
| #669 | d00d7b4 | 6c8365b | Auditor review record, PASS at 6c8365b |
| #670 | fa1d452 | 620216b | Auditor review record and message, PASS at 620216b |
| #671 | d70bf9a | df2d4c4 | Auditor review record and message, PASS at df2d4c48 |

#664 and earlier PRs are excluded. #664's PASS was at cbf5503 but its merged head was 1faf42c. Earlier PRs have no
PASS record at their merged head.

Result: 44 files are admitted (7 specs and 37 tests from the m168-m173 work), listed with blob and PRs in
lb-corpus2.json sources.files. The bin recomputes the list from git and refuses on any difference
(sources_files_differ). The dev-task rule below then drops 4 of them, so 40 files are built.

## Public dev tasks (Auditor #673 B1)

No train doc may name, diagnose or encode the fix of any of the 12 public dev tasks in peaceai/plan/tasks-public-v1.json
(sha-pinned in sources.devTasks). lbcorpus2.ts devTaskHits() flags a file text on four kinds of hit, all derived from
the task set and its reference fixes, never from the corpus:

- dev_name: a task's owner/repo, repo name or task id, case-insensitive, not inside a longer word.
- dev_span: a backticked span of 4+ tokens from a task's request text, token for token.
- dev_sha: a hex run of 7-40 characters that is a prefix of a task's commit or reference merge.
- dev_fix: a 10-token shingle of a reference diff's added-line runs. Shingles are kept exact, and also with
  identifiers abstracted when the window holds 2+ JS keywords. Each is stored as a 16-hex hash in
  peaceai/model/lb-corpus2-devfix.json; any shingle that also occurs in the chain-1 base corpus is removed, so a
  generic code phrase cannot hit.

Every hit file needs a decision in sources.devTasks.decisions with exactly its hits:
- drop: the file diagnoses a dev-task fault or carries reference-fix text. It is kept out of every split.
- heldout_v2: the file only names tasks (run status, negative-assertion name lists). It is never trained on.

The bin refuses devtask_set_differs, devtask_fix_differs, devtask_undecided and devtask_decision_stale, and after the
build refuses devtask_in_train if any train doc of the new set still hits. m180 checks the committed new manifest the
same way from the file blobs, and shows that injecting a dropped or moved dev-task doc, a dev repo name, a task id, a
request span or a merge sha into train fails the check.

Result: 11 hit files. Dropped (4): peaceai/spec/edit-proposer-v2.md, peaceai/spec/repair-v2-m172.md,
peaceai/spec/repair-v2-m173.md, peaceai/test/m172-cases.ts. Moved to heldout_v2 (7): peaceai/spec/loop-deps-access-v1.md,
peaceai/spec/loop-isolation-v1.md, peaceai/spec/loop-runners-v2.md, peaceai/spec/loop-runners-v3.md,
peaceai/test/m168-repair-v2.test.ts, peaceai/test/m170-cases.ts, peaceai/test/m173-batch12.test.ts. The reasons are in
lb-corpus2.json.

FYI, chain-1 base (batch 15 note; no change to any pin, split or decision): the chain-1 base train set, which v2
keeps at its pins, already includes 16 docs that mention a dev-task library in passing, and 1 immer doc that
matches the idiom of one dev task's library. None of them carries a diagnosis of a dev-task fault or reference-fix
text. Even so, dev-set results from chain-1 and chain-2 models must not be over-claimed: a dev-set gain from those
models is not clean evidence of generalization, and only a held-out result counts. (The library names are left out
here on purpose, so this note never becomes a dev_name hit itself.)

## Held-out (condition 4)

- The old split (`heldout`) is unchanged: the same docs, bytes and ids. train.py reads split == "heldout" for its
  eval stream, so the days 1-3 bpb series stays comparable.
- The new slice (`heldout_v2`) is a per-FILE draw: sha256("peaceai-lb-corpus2:v1\nslice\n" + path), first 32 bits,
  compared with rate 0.15. Every piece of a file therefore lands on the same side. lb-clean sees heldout_v2 as
  heldout (no FIM, no repeats), and the label is restored on output. train.py ignores heldout_v2, so it is never
  trained on. Wiring a separate heldout_v2 eval is part of the later chain-2 PR.
- Unigram baseline note: export.py derives the baseline from tokens_train.npy. The train split grows by 74 docs (of
  about 60.9k), so chain 2's baseline can differ from 2.5156 in a late decimal. Chain-2 rows must carry their own
  baseline.

Non-overlap is a hard post-condition: the build refuses with overlap_found and writes nothing if it fails.
1. Every new piece is first dropped if its normalised key equals, or its shingles near-duplicate (Jaccard >= 0.8,
   the lb-clean NearIndex), any chain-1 doc. Its FIM and repeat followers are dropped with it.
2. overlapProblems then counts 9 numbers. All must be 0.
   - Pairs: new train vs old heldout, new train vs heldout_v2, and chain-1 train vs heldout_v2.
   - Each pair is counted three ways: exact (text sha256), norm (normalised key) and near (shingle Jaccard >= 0.8).
3. `lb-corpus2.ts --check <out>` recomputes the counts on any built corpus.
4. m180 covers each count and a near miss just below each bar (one edit step under nearJaccard is kept, both in the
   append pass and in the check). It also checks the committed new manifest: no slice path or text sha256 appears
   on the train side.

## Pins (condition 2 and 3: published before training)

The build was run twice and the outputs are byte-identical.

| item | value |
|------|-------|
| docs.jsonl sha256 | in lb-corpus2.json build.docsSha256 |
| manifest.jsonl sha256 | in lb-corpus2.json build.manifestSha256 |
| fingerprint | in lb-corpus2.json build.fingerprint |
| full fingerprint parts | peaceai/model/lb-corpus2-fingerprint.json |
| appended manifest rows | peaceai/model/lb-corpus2-new-manifest.jsonl, sha in build.newManifestSha256 |

The full v2 manifest is chain 1's manifest bytes followed by these rows. The fingerprint covers:
- this code, lbclean.ts, nlpairs.ts and tsresolve.ts;
- the TypeScript version;
- lb-clean.json, the exclusion file and the sources block;
- the base pins and the new input;
- the public refs;
- the drop-hash file (lb-hidden-drop-hashes.txt, passed as input only);
- the output.

m180 fails if any of these code or input files changes without a re-pin.

For Auditor's hidden check: the bin also writes <out>/check/{docs,manifest}.jsonl, which holds the new docs alone
with heldout_v2 written as heldout (lb-clean's split vocabulary). It is ready for `lb-clean --report-only`. The
chain-1 part was already cleared at exactly its pins.

Reproduce:
1. Run peaceai/bin/lb-corpus-rebuild.sh, which gives the chain-1 out/ and refs/ at their pins.
2. Optional (the devfix file is committed and sha-pinned): fetch each task's reference diff as sources.devTasks.diffs
   says into <diffs>/<task id>.diff, then
   `tsx peaceai/bin/lb-corpus2.ts --devfix --diffs <diffs> --base <work>/out --out peaceai/model/lb-corpus2-devfix.json`
   gives the same bytes.
3. Run:

```
tsx peaceai/bin/lb-corpus2.ts --repo <full-history clone with d70bf9a> --base <work>/out --refs <work>/refs \
  --exclusions peaceai/model/nl-pairs-exclusions-hidden-hashes.txt \
  --drop-hashes peaceai/model/lb-hidden-drop-hashes.txt --out <dir>
```

## Conditions (Auditor, binding) and where each is met

1. Sources: the rule above and the PR list. Anything not attributable is excluded.
2. New chainId and pins; warm start sha-checked before training: the decision section above. The check itself
   comes in the later PR, which does not run training.
3. Publish before training: the pins are committed here. Training waits for Auditor's PASS (= 0).
4. The same held-out split plus a new slice, non-overlap tests and near-miss tests: m180.
5. Results add-only, latest.json untouched, R2 only from main, no paid compute: this PR touches none of them.
6. Build isolation (Auditor #673, binding on the chain-2 run PR, not implemented here): the run PR must build
   lib/lbcorpus2.ts and bin/lb-corpus2.ts in a separate job with no secrets, and pass on to the training job only
   output whose sha matches the protected pin. No /approve-rule is needed for this data-only PR.
