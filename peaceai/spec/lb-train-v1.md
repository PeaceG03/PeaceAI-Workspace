# lb-train v1: limit-breaker training improvements (M157-M161)

Status: implemented in peaceai/model (lbtrain.py, train.py, saves.py, daily_cycle.py, lb-train.json) and
peaceai/bin/lb-daily-cycle.sh. Everything is OFF by default: a run with no new flag is bitwise the run of the
previous train.py (m157 checks params, Adam moments, losses and config keys against origin/main). All of it is
numpy on CPU, from scratch (CONSTITUTION 12: no pretrained weights, no new dependency).

Training data: only an Auditor-cleared corpus. Today that is exactly one corpus (lb-train.json clearedCorpora):
docs 7eb6c628..., manifest e9f78828..., fingerprint a3e9165f..., built at b149d9b. Any other corpus needs a fresh
Auditor hidden check and an add-only entry in lb-train.json.

## M157 precision and 8-bit optimizer

- `--precision fp32|bf16|auto` (default fp32). bf16 is EMULATED: the 2-D weight matrices are rounded to bf16
  (round to nearest even, NaN/inf kept) for the forward and backward pass; fp32 master weights get the update.
  numpy has no native bf16, so `auto` resolves to fp32. There is no speed or memory gain on this backend; the flag
  exists so the run records which numerics it used and so a future backend can honour it.
- `--optimizer adamw|adamw8bit` (default adamw). adamw8bit is the same AdamW math with the moments stored
  block-wise (256): m as int8 with an absmax scale, v as uint8 of sqrt(v) with a scale. About 1/4 of the fp32
  optimizer-state bytes (m157 checks < 0.3). The step dequantizes one tensor at a time, so peak memory is not
  reduced by the same factor.
- A non-default choice goes into cfg (save manifest cfgSha256, the resume config check) and run.json.
- Refusals: PRECISION_BAD, OPTIMIZER_BAD, OPT8_GRAD_NONFINITE, OPT8_NONFINITE, OPT8_NEGATIVE, CHECKPOINT_OPT_MISMATCH,
  SAVE_CONFIG_MISMATCH (resuming with another optimizer or precision).

## M158 easy-to-hard curriculum

- `--curriculum easy_to_hard` (default off), `--curriculum-start 0.25`, `--curriculum-ramp N` (0 = steps/2),
  `--curriculum-seed` (default --seed).
- Train docs are ordered by the lb-clean manifest `difficulty.score`; ties by sha256("seed:doc"). The token
  stream is re-laid in that order in memory only (tokens_train.npy on disk is unchanged, so export.py is not
  affected). Batches are drawn from the easiest prefix, growing linearly from start*N tokens to N over the ramp,
  never below one window. Deterministic: same seed, same run; resume is bitwise.
- Refusals: CURRICULUM_BAD_ARGS, CURRICULUM_NO_DIFFICULTY, CURRICULUM_WITH_REPLAY (replay keeps its own mix),
  CURRICULUM_STREAM_MISMATCH.

## M159 stopping rule

- An eval improves only when val < best - `--min-delta` (default 0) and val is finite. `--patience` evals without
  improvement stop the run. `--steps`, `--max-steps-this-run`, `--max-seconds` and `--deadline` bound it.
- A non-finite training loss stops the run before the update: reason "nonfinite", the chain marker has
  more=false, best.npz keeps the last finite best.
- Every run writes stop.json (schema peaceai-lb-stop:v1): reason, step, totalSteps, bestStep, bestVal, lastVal,
  stale, patience, minDelta, maxSeconds, elapsedSeconds.
- Refusal: STOP_BAD_ARGS (negative patience, negative or non-finite min-delta).

## M160 daily cycle

`peaceai/bin/lb-daily-cycle.sh CORPUS STATE BUDGET_MIN [YYYY-MM-DD] [-- train args]`:
plan (checks) -> train.py within the budget, resuming from the newest verified local save -> export.py eval ->
STATE/reports/<day>.json. One cycle per day; a finished chain writes a "done" report and trains nothing.

- Corpus must match one lb-train.json clearedCorpora entry exactly (DAILY_CORPUS_NOT_CLEARED).
- Free compute only: on GitHub Actions only RUNNER_ENVIRONMENT=github-hosted (DAILY_NOT_FREE_RUNNER).
- Budget is whole minutes 1..340; train args only from daily.trainArgsAllowed (DAILY_BAD_ARGS). The cycle owns
  corpus, work, saves, marker, resume, budget, init-from and replay.
- Saves without a chain marker, a marker that is not one, or a marker not naming the newest save:
  DAILY_STATE_INCONSISTENT (never a fresh start over existing saves).
- Writes only under STATE. No network, no upload, no cloud storage.
- LoRA is not available in the daily cycle (--init-from and --lora-* are not allowed).

NOT SCHEDULED. No workflow file runs it (m160 checks .github/workflows). The wrapper below is a DRAFT ONLY and
needs Auditor and Peace before it is installed. It is manual (workflow_dispatch), GitHub-hosted, and keeps STATE
in the Actions cache, so it adds no paid compute and no storage outside GitHub:

```yaml
# DRAFT - not installed. needs Auditor and Peace.
name: lb-daily-cycle
on:
  workflow_dispatch:
    inputs:
      budget_min: { description: "minutes (1..340)", required: true, default: "300" }
permissions: { contents: read }
jobs:
  cycle:
    runs-on: ubuntu-latest
    timeout-minutes: 350
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install -r peaceai/model/requirements.txt
      - run: bash /path/to/lb-corpus/rebuild.sh corpus repo:peaceai/model/lb-hidden-drop-hashes.txt  # cleared corpus, pinned commit
      - uses: actions/cache/restore@v4
        with: { path: state, key: lb-daily-${{ github.run_id }}, restore-keys: lb-daily- }
      - run: bash peaceai/bin/lb-daily-cycle.sh corpus state "${{ inputs.budget_min }}" -- --threads 4
      - uses: actions/cache/save@v4
        if: always()
        with: { path: state, key: lb-daily-${{ github.run_id }} }
```

## M161 LoRA

- `--lora-rank r` (default 0 = off), `--lora-alpha` (default r), `--lora-targets` (default wqkv,wo; any of
  wqkv, wo, w1, w2), with `--init-from BASE.npz` on a fresh run.
- W_eff = W + (alpha/r) A@B, A ~ N(0, 1/din), B = 0, so step 0 is exactly the base. The base is frozen (checked on
  every resume against its params_sha256); only A and B train and have optimizer state.
- Saves: checkpoint.npz holds the base (p.*) and adapters (l.*); adapter.npz and best-adapter.npz hold only the
  adapters plus the base's params_sha256; best.npz is the merged model, so eval and export.py work unchanged.
- `python3 peaceai/model/lbtrain.py lora-merge BASE.npz ADAPTER.npz OUT.npz` rebuilds the merged model (m161:
  bitwise best.npz). It never overwrites OUT.
- The backward pass still computes the full weight gradient and projects it onto A and B: correct, but no compute
  saving on this backend; the saving is in trainable parameters and optimizer state.
- Refusals: LORA_NEEDS_BASE, LORA_BAD_RANK, LORA_BAD_ALPHA, LORA_BAD_TARGETS, LORA_SHAPE, LORA_SCHEMA,
  LORA_BASE_MISMATCH, LORA_OUT_EXISTS.

## Tests

m157-m161 (peaceai/test), the case driver m157-lbtrain-cases.py and the helper m157-lbtrain-mut.ts. Every tagged
guard (`# guard:<name>` in lbtrain.py and daily_cycle.py) has one case; each test disables its guards one at a
time (`if False:`) in a copy of the model dir and requires the case outcome to change.
