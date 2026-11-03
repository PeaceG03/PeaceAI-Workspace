# lb-chain2 (limit-breaker chain 2: the run) - v1

Status: WIRED, NOT DISPATCHED. This PR adds the chain-2 workflow and its checks. It dispatches nothing and has no
schedule. Each chain-2 day is one manual workflow_dispatch of peace-lb-chain2.yml from main, after merge.

## What chain 2 is

- A NEW lb-daily chain on the lb-corpus v2 (spec lb-corpus2-v1.md). Its corpus pins are the v2 build pins
  (docs 9a78ef05..., manifest 4c950ca4..., fingerprint 8ecd9cec...), cleared by one add-only lb-train.json
  clearedCorpora entry. Its chainId is the run id of its first dispatch, never chain 1's 41222155935. Its saves go
  to R2 lb-daily/<chain 2 id>/ (add-only). Its rows go to Results runs/lb-chain2/<day>-<run id>.json (add-only).
- Day 1 warm-starts from chain 1's final save, save-000006000 (manifest sha256 1e513e50...). The weights and the
  tokenizer are loaded; the optimizer is fresh and the step count starts at 0 (train.py --warm-start-from,
  warmstart.py). Later days resume the chain-2 save, as chain 1 did.
- The model shape and the tokenizer are chain 1's, so the days-1-3 held-out split tokenizes identically.

## Config

lb-train.json chain2Run holds the corpus pins, the committed fingerprint file sha256, r2Folder lb-daily,
resultsDir lb-chain2, the job and train deadlines, the train settings (same shape as dailyRun) and warmStart:
fromChain, save, manifestSha256, cfgSha256, the day-3 Results row runs/lb-daily/2026-11-03-41572356445.json with its
file sha256 and Results commit, and that row's heldoutTokens, heldBytes, heldoutBpb 0.6688 and baselineBpb 2.5156.
lb-corpus2.json chain2 repeats the warm-start pin and enabled. lb_chain2.py config refuses any disagreement.

## Workflow: peace-lb-chain2.yml (workflow_dispatch only; main only; GitHub-hosted, free)

| job | environment | permissions | secrets | does |
|---|---|---|---|---|
| c2-ref-gate | none | {} | none | refuses unless refs/heads/main |
| c2-corpus | none | contents: read | none | lb-chain2-corpus.sh: chain-1 rebuild at b149d9b + the v2 builder; uploads 3 files (1 day) |
| c2-train | peaceai-results | contents: read | Results key (2 steps), 4 R2 secrets (2 steps) | pins check, trusted read, restore, train, copy, row, land |

c2-train order: ref + config -> download the artifact -> lb_chain2.py pins (docs, manifest and fingerprint.json
against the protected pins, fail closed; no secret before this) -> numpy venv -> checkout and key-script verify ->
trusted read (Results runs/lb-chain2/ plus the one day-3 row, read only) -> R2 get + lb_chain2.py restore (sha
checks) -> lb-chain2-run.sh (lb-daily-cycle.sh with chain2Run args, then eval_v2.py) -> re-verify -> R2 put-one ->
lb_chain2.py row -> re-verify -> land one row -> cleanup. The train job never runs node.

## Binding conditions (Auditor #673) and where each is met

1. Build isolation: lib/lbcorpus2.ts and bin/lb-corpus2.ts run only in c2-corpus (no environment, no secrets,
   contents: read, persist-credentials: false). lb-chain2-corpus.sh also refuses to start
   (LB_C2_BUILD_HAS_SECRET) if any secret-like variable is set (R2, deploy key, token, password, private key,
   SSH agent, askpass; ACTIONS_RUNTIME_TOKEN is the one allowed name). Only docs.jsonl, manifest.jsonl and
   fingerprint.json leave the job. c2-train sha-checks all three against the protected pins before any secret and
   fails closed (LB_C2_CORPUS_FILES, LB_C2_CORPUS_SHA_MISMATCH). m181: the script test (each name refused, mutant
   killed, near misses pass) and chain2Problems (build-secret, builder, artifact, pins mutants).
2. New chain and new pins; warm start sha-checked: config (c2-new-pins, c2-warm-plan), trusted (the day-3 row
   file sha256, its marker save and sha, more=false), restore (saves.verify_save on the warm save against the pin,
   and its cfgSha256), and train.py --warm-start-from (warmstart.py re-verifies; a resume must carry the same pin,
   else SAVE_CONFIG_MISMATCH). Rows must carry a chainId other than chain 1's.
3. Same held-out split: every row's heldoutTokens and heldBytes must equal the day-3 row's
   (LB_C2_HELDOUT_SPLIT_DIFFERS). heldout_v2 is reported separately in the row's heldoutV2 (eval_v2.py).
4. Results rows add-only (land refuses an existing name, LB_C2_ROW_EXISTS, and symlinks), latest.json never
   written, R2 used only from main (ref gate, job if, in-job ref check).
5. Baseline: each row carries heldoutBpb with its own same-split unigram baselineBpb and the verdict.

## Notes

- Over-claim: see lb-corpus2-v1.md "dev-task mentions already in the chain-1 base train set".
- The build job runs the unprotected builder. A secret-like env var on the runner would make it refuse (fail
  closed), not leak.
- Every lb_chain2.py guard (c2-*) and warmstart.py guard (ws-*) is tagged and has a killed mutant in m181.
