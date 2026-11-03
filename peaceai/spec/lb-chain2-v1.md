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

## v2: warm-start continuation fix (Auditor's conditions on chain-2 day-1 run 41686765194)

Run 41686765194 (row runs/lb-chain2/2026-11-03-41686765194.json, schema v1) was VALID-WITH-CONDITIONS: held-out
bpb 0.7026 against chain 1's 0.6688. Two causes: (a) best started at inf, so the step-0 warm start was never a
candidate and the step-100 model became best by default; (b) the LR re-warmed to 3e-4 (5x chain 1's final 6e-5)
with a fresh optimizer. v2 changes only the chain-2 path (train.py warm-start branch, warmstart.py, lb_chain2.py,
lb-train.json chain2Run and daily.trainArgsAllowed); the workflow and every key script are unchanged.

1. Step-0 score (condition 1). On the warm day lb_chain2.py cycle-args adds
   `--warm-start-expect BPB:TOKENS:BYTES:TOL` = warmStart.heldoutBpb (0.6688, the day-3 row's model_bits_per_byte),
   heldoutTokens (49152), heldBytes (192892) and chain2Run.step0TolBpb (0.0005). train.py refuses a warm start
   without it (WARM_START_EXPECT_REQUIRED), a malformed one or TOL above 0.002 (WARM_START_EXPECT_BAD), and an expect
   without a warm start. Before the first training step, warmstart.step0_eval scores the loaded model exactly as
   export.py does (weights through fp16, at most 96 non-overlapping ctx windows of tokens_heldout.npy, 4 windows per
   forward, bytes = the tokenizer's decode of the targets, bpb rounded to 4 places). It must use the same split
   (tokens and bytes equal, else WARM_START_STEP0_SPLIT) and |bpb - BPB| <= TOL (else WARM_START_STEP0_MISMATCH).
   Each refusal is one filtered code on stderr (the daily report's code), and nothing is trained or saved.
   The weights are the save's best.npz: that is the model export.py scored for the day-3 row (lb-daily-cycle.sh
   exports best.npz when it exists). v1 loaded checkpoint.npz (step 6000), which equals best.npz only if chain 1's
   best step was 6000. checkpoint.npz is used only for a save without best.npz. The step-0 result is written to
   work/<day>/step0.json and copied into the row (step0).
2. Best seeded with step 0 (condition 2). warmstart.seed_best sets best.json to the step-0 val loss (the same
   disjoint val windows every later eval uses). train.py then saves step 0 as checkpoint.npz and best.npz. A later
   eval becomes best only if it beats step 0 by more than --min-delta. A day that never does keeps best.npz = the
   warm-start model, so export.py exports it unchanged. Its row has bestStep 0 and improved=false, and its
   heldoutBpb must equal step0.bpb within TOL (c2-row-no-improve-export). The row line prints
   verdict=...,no_improvement. Chain 2 never writes latest.json and has no promotion step, so it promotes nothing.
   best.json and best.npz travel in every save, so resume days keep the seed.
3. LR and optimizer (condition 3). chain2Run.train is --lr 0.00006 --warmup 0. lb_chain2.py config refuses
   warmup != 0 or lr > warmStart.finalLr (6e-05, pinned; LB_C2_LR). train.py re-checks against the save itself:
   warmup must be 0 (WARM_START_LR_REWARM), and lr must be at most lr_at(step - 1) of the save's own cfg
   (WARM_START_LR_ABOVE_FINAL). For chain 1 that is lr_at(5999) of lr 6e-4, warmup 30, steps 6000, about 6.0000000e-05.
   Under lm.lr_at with warmup 0, step s gets 6e-5 * (0.1 + 0.45 * (1 + cos(pi * s / 4000))), which is at most
   6e-5 at s = 0 and falls to 6e-6.
   The optimizer state is kept, not fresh. warmstart.load_opt reads the AdamW 8-bit moments and t from the save's
   checkpoint.npz (sha re-checked against the manifest). The optimizer must equal the save's
   (WARM_START_OPT_MISMATCH).
4. Rows v2 and the retired v1 chain. Row schema peaceai-lb-chain2-run:v2 adds step0 (warm day only, else null),
   bestStep and improved (= bestStep > 0). v1 rows are still fully validated, and they still count for once-a-day
   (c2-once). They no longer decide warm / resume / done. A v2 chain may not reuse a v1 chainId
   (c2-retired-chain). The finished v1 chain (more=false, which would otherwise be LB_C2_CHAIN_DONE forever) is
   therefore followed by a new chain. Its chainId is the run id of its first v2 dispatch, and it warm-starts again
   from the same pinned chain-1 save. The v1 chain's saves and row are untouched. Rows stay in runs/lb-chain2/ (the
   workflow's sparse paths).

### Soundness note

- What step 0 proves. The step-0 model is pinned three ways: the manifest sha 1e513e50, the day-3 row sha, and
  verify_save, with best.npz re-hashed when loaded. The tokenizer is copied byte for byte, and tokens_heldout.npy is
  checked by token and byte count. So reproducing 0.6688 shows that loading, tokenization, split and eval code are
  all the chain-1 ones. A mismatch means something in that chain differs, and the day stops before any training.
- Why 0.0005. The pinned 0.6688 is rounded to 4 places (+-0.00005). The remaining difference is float summation
  order: train.py runs BLAS with --threads 4, export with 1, a relative CE change near 1e-7. The tolerance is 10x
  the rounding and under 1/60 of the 0.0338 regression it guards against. The code caps it at 0.002.
- Why a regression cannot become best. best starts at the step-0 val loss, not inf, and improved() needs a finite
  val below best - min_delta. So best.npz is always the step-0 model or a model whose val loss beat it. Selection
  uses the disjoint val windows, not export's held-out windows. A val gain therefore does not guarantee a held-out
  gain, but the selector never prefers a val regression. The row reports both step0.bpb and heldoutBpb.
- Why keep the optimizer, and the residual risk. A fresh Adam has m = v = 0. Its first updates are about lr * sign(g)
  for every parameter, whatever the gradient scale, and that shock comes on top of the re-warm. The kept 8-bit
  moments are chain 1's gradient statistics at step 6000 (b1 0.9, b2 0.95, so horizons of about 10 to 20 steps).
  With t about 6000, the bias corrections are about 1.
  Residual risk: if chain 1's best step was before 6000, the moments come from a later point on the same
  trajectory at the floor LR, not from best.npz itself. They re-adapt within tens of steps at lr <= 6e-5. The
  Results row does not record chain 1's best step, but the step-0 check makes the weights exact either way.
- Tests: m181. Every new c2-* and ws-* guard has a killed mutant. There are admit and near-miss cases for the
  step-0 tolerance (+-0.0004 passes, +-0.0006 refuses), the LR cap (the final LR passes, a hair above refuses,
  warmup 1 refuses) and seeding. Separate mutants remove the train.py call sites one at a time: the step-0 check,
  the seed, the LR check, the kept optimizer, and the best.npz choice. End to end, a warm day's step0.bpb equals
  chain 1's exported bpb. A --min-delta 10 day keeps bestStep 0 and exports exactly chain 1's bpb, after a retired
  v1 row.
