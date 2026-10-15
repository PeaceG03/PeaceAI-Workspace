# M49 LM run plan, aimed at task success (DRAFT for Architect, not run)

Status: draft only. No training run, no promotion, no workflow change made. Every step needs Architect's go.

## Why
Held-out task success is 0 for both lm-v1-78b6e96990d2 and lm-v1-088073d41dbc on sets A and B (M37/M44). Loss on
set C v2 improved, but loss alone isn't producing passing edits. This run is aimed at the edit tasks themselves.

## Limits it must fit (current peace-lm-train.yml)
- ubuntu-24.04 free runner, 4 threads, job timeout 330 min, train --max-seconds 14400 (4 h), early stop patience 4.
- Resume exists (--max-steps-this-run + work dir), so a longer schedule can run as 2-3 chained jobs, each under
  the 4 h cap, with no change to the per-job limits.

## Changes (each one a separate, reviewable knob)
1. Bigger corpus slice: raise the licensed external slice from the current share to the full licensed pool minus
   set C v2 and heldout-c-excluded (same file filters, same content-sha256 hold-out, memcheck unchanged).
   Report bytes and files per repo before training.
2. Longer context: ctx 512 -> 1024. Function-body tasks need the whole file head (imports, types) plus the function.
   Cost is about 2x per step; offset with batch 16 -> 8 at the same tokens per step.
3. More steps within the free limits: about 2x the current steps, split over 2 resumed jobs. Patience stays on, so a
   flat run stops early instead of burning the budget.
4. New stage, function-body fine-tune (after pretrain, same model):
   - Data: Peace-authored commits (authorship-filtered, the same filter as the miner) plus Builder-landed changes
     (patch-flow commits from Results with matching SHA-256), as (file with body blanked) -> body pairs.
   - Strict exclusion: no set A/B held-out commit, nothing in heldout-c-excluded, no set C v2 file, and no
     M48 task (peaceai/model/heldout-c-tasks.json) by file content sha256.
   - Small LR, few hundred steps, early stop on a held-out slice of the fine-tune pairs.

## Measurement (decides promotion, which stays a separate Peace/Architect decision)
- Task success on sets A and B (pass / fail / ungradable, full denominator), as in M37.
- Set C v2 task success on the 138 M48 tasks (static token-equal grading; needs #176 reviewed and wired first).
- Set C v2 loss per byte (byte mode) old vs new, so tokenizers compare.
- Promote only if task success goes up with loss per byte no worse; otherwise report and keep the old model.

## Risks
- Fine-tune data is small (tens to low hundreds of pairs); overfitting is likely. The early stop and the strict
  exclusions are the guard.
- ctx 1024 may not fit 4 h even with resume; fall back to 768.

## Steps once approved
1. PR: corpus slice + ctx/batch/steps knobs (protected, Auditor review).
2. PR: fine-tune stage builder + exclusion tests (protected).
3. Dry run on the box (no upload, no promotion), then the Actions run when Architect says go.

## Implementation (this PR)
- `.github/workflows/peace-lm-train-m49.yml`: pretrain-1 -> pretrain-2 -> pretrain-3 (resume through Results
  `runs/lm-work/<run id>/part-N/`, 90 MB chunks + SHA256SUMS, append-only, prefix-checked) -> finetune-eval-land.
- `peaceai/model/ext-train-m49.json`: ctx 1024, batch 8, 2100 steps as 3 x 700, fine-tune 300 steps at lr 1e-4.
- `peaceai/model/train.py`: `--lr`, `--warmup` (defaults unchanged, so M37 checkpoints still resume), `--init-from`.
- `peaceai/lib/ftpairs.ts`, `peaceai/bin/ft-pairs.ts`: fine-tune pairs (box smoke: 42 docs, 40 train / 2 held out).
- `peaceai/model/eval_ab.py` (sets A/B task success), `peaceai/model/gen_c.py` (+ #177 grader for the #176 tasks).
- Corpus slice: `corpus.repoCapBytes` in the config; the manifest regen and its PASS memcheck record are a box step and
  land as their own protected PR before any run (the workflow trains only on the committed, memchecked manifest).
- Depends on #177 (setc-grade.ts) for the set C task eval; until it merges that eval step reports FAILED (non-fatal).
- No run is triggered by this PR. Box dry run, then the chained run, only when the Architect says go.
