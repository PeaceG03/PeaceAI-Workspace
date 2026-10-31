# lb-train v1: limit-breaker training improvements (M157-M161)

Status: implemented in peaceai/model (lbtrain.py, train.py, saves.py, daily_cycle.py, lb-train.json) and
peaceai/bin/lb-daily-cycle.sh. Everything is OFF by default (precision is fp32 only): a run with no new flag is bitwise the run of the
previous train.py (m157 checks params, Adam moments, losses and config keys against origin/main). All of it is
numpy on CPU, from scratch (CONSTITUTION 12: no pretrained weights, no new dependency).

Training data: only an Auditor-cleared corpus. Today that is exactly one corpus (lb-train.json clearedCorpora):
docs 7eb6c628..., manifest e9f78828..., fingerprint a3e9165f..., built at b149d9b. Any other corpus needs a fresh
Auditor hidden check and an add-only entry in lb-train.json.

## M157 8-bit optimizer (precision is fp32 only)

- Precision is fp32 only. An emulated bfloat16 option existed in a draft of this PR and was DROPPED (Auditor
  ruling on #654): there is no precision flag, no precision key in cfg, run.json or the daily report, and a default
  run stays bitwise origin/main's.
- `--optimizer adamw|adamw8bit` (default adamw). adamw8bit is the same AdamW math with the moments stored
  block-wise (256): m as int8 with an absmax scale, v as uint8 of sqrt(v) with a scale. About 1/4 of the fp32
  optimizer-state bytes (m157 checks < 0.3). The step dequantizes one tensor at a time, so peak memory is not
  reduced by the same factor.
- A non-default choice goes into cfg (save manifest cfgSha256, the resume config check) and run.json.
- A work-dir checkpoint resumes only with exactly its config: every key of either side is compared (total_steps
  excepted), so resuming a default checkpoint with `--optimizer adamw8bit` (or the reverse) is
  CHECKPOINT_CONFIG_MISMATCH, never a KeyError.
- Refusals: OPTIMIZER_BAD, OPT8_GRAD_NONFINITE, OPT8_NONFINITE, OPT8_NEGATIVE, CHECKPOINT_OPT_MISMATCH,
  CHECKPOINT_CONFIG_MISMATCH, SAVE_CONFIG_MISMATCH (resuming a save with another optimizer).

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
  stale, patience, minDelta, maxSeconds, elapsedSeconds. It is written last (after timing.json), with O_EXCL.
- Every other exit writes stop.json too: train.py's body runs under try/except BaseException, and any refusal
  (STOP_*, SAVE_*, CHECKPOINT_*, LORA_*, OPT8_*, CURRICULUM_*, REPLAY_*, ...) or crash writes
  {schema, reason: "error", code, step} and re-raises unchanged. code is the fixed refusal name (the part before
  any ":"); a message that is not a fixed name becomes TRAIN_ERROR, any other exception TRAIN_CRASH, Ctrl-C
  INTERRUPTED; it never holds a message or a path. A clean exit (status 0) writes no error record.
- A stale stop.json (or a symlink there) is removed at the start of every run, before any check, so the file
  always describes this run.
- Refusal: STOP_BAD_ARGS (negative patience, negative or non-finite min-delta).
- Validation split (batch 6, Auditor's #660 note): `--val-split first|disjoint`. The early-stop val loss uses 16
  held-out windows (window k = held[k*T : k*T+T+1]). `first` (the default, unchanged for every other caller) is
  windows 0..15, which are also the first 16 of the 96 windows export.py's eval uses, so the stopping rule and best.npz
  were chosen on data that is part of the reported held-out eval. `disjoint` is windows 97..112: export's windows
  0..95 cover token indices 0..96*T and window 96 starts on export's last target token, so from window 97 on no token
  is shared (m159 asserts it, including the real 1225844-token first-run held-out size). Fewer than 113 windows
  (the full 97..112 set; batch 7: 98..112 used to validate on fewer than 16 windows, now refused):
  VAL_NOT_DISJOINT; with replay (its val is the replay heldout docs): VAL_SPLIT_BAD. best.json records
  valSplit for a non-default split, and a best.json from another split is not resumed (early stopping restarts from
  inf), so a best chosen on the old windows never carries over. The split is not part of the model cfg, so saves and
  chains resume across the change. lb_run.py (LB_RUN_SETTING_REQUIRED) and lb_daily.py (LB_DAILY_SETTING_REQUIRED)
  require `--val-split disjoint` in firstRun.train / dailyRun.train.
- Honest note on runs before this change: the first real run (41187515379, held-out 1.1506 vs baseline 2.5156 bpb)
  and the daily runs started before it (from 41222155935) used the `first` split, i.e. val windows that overlap the
  eval. The 1.1506 result stands as Auditor passed it, but its stopping point and best checkpoint were selected on 16
  of the 96 eval windows, so it is mildly optimistic, not a clean held-out number. The next daily resume restarts
  early stopping on the disjoint split.

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
- No write goes through a symlink: STATE itself, STATE/saves, work, logs and reports must be real directories,
  every STATE/saves entry a real directory, chain.json a regular file and chain.json.tmp absent
  (DAILY_STATE_INCONSISTENT; the report step re-checks). An existing logs/<today>.* (file, symlink or dangling
  symlink) is refused, the shell opens its logs with noclobber (O_EXCL) and reports are created with
  O_CREAT|O_EXCL|O_NOFOLLOW.

NOT SCHEDULED. The only wrapper is the manual-dispatch workflow `.github/workflows/peace-lb-daily.yml` (M165, Auditor
ruling once R2 was ready; Peace's bucket-scoped key is in this repo's environment peaceai-results, main only). m160
checks no other workflow names the cycle; m165-lb-daily-run.test.ts pins the wrapper's shape. Per dispatch:

- workflow_dispatch only, never scheduled; a ref gate job and lb_daily.py ref refuse any ref but refs/heads/main;
  GitHub-hosted ubuntu-24.04 (free compute), timeout 355 min, train deadline 300 min from the job start;
- the trusted record is the newest add-only Results row runs/lb-daily/<day>-<run id>.json (read through
  results-write.sh with nothing written; none yet = fresh chain, id = this run id; done = nothing trains);
- saves live only in R2 under their own folder lb-daily/<chain id>/ (lm-saves-r2.sh --folder lb-daily), never next
  to Results files, never latest.json; the restored save must hash to the record's manifest sha256 before any
  resume (LB_DAILY_SAVE_SHA_MISMATCH), chain.json is written from the record, and lb-daily-cycle.sh refuses a plan
  that is not the trusted one (LB_DAILY_EXPECT, DAILY_PLAN_UNTRUSTED). The sha never comes from the bucket or state;
- the checkout and key scripts are re-verified right before each later key use (copy, land); the new save is
  uploaded with put-one (its own manifest sha256 only; an existing name is refused, R2_SAVE_EXISTS; the bucket is
  add-only, nothing is removed); then ONE add-only row is landed (new file only, never latest.json);
- LoRA is refused (dailyRun.loraUnlock: until a full-model run beats the same-split unigram baseline 2.5156 bpb,
  LB_DAILY_LORA_LOCKED; the wrapper passes no LoRA flag even after);
- no Actions artifacts or cache; the R2 secrets are in env only for the restore and copy steps, the Results key only
  for the record read and landing; nothing echoes them; actions sha-pinned, persist-credentials false.

Limitation: after a chain reports done, a new chain needs a dailyRun config change (reviewed PR). Any change to the wrapper's
shape (a schedule, another ref, LoRA, another storage place) needs Auditor and Peace first.

Known limitation (fails closed): main's train.py refuses saves made by this PR's train.py (SAVE_FILE_SET: every
save now holds run.json, and LoRA saves adapter.npz / best-adapter.npz, which main's saves.py does not allow). If this PR is rolled back, a chain started with it cannot
be resumed by main; it must start fresh. Nothing is loaded wrongly; the resume is refused.

## M161 LoRA

- `--lora-rank r` (default 0 = off), `--lora-alpha` (default r), `--lora-targets` (default wqkv,wo; any of
  wqkv, wo, w1, w2), always with `--init-from BASE.npz`, on a fresh run AND on every resume (LORA_NEEDS_BASE).
- W_eff = W + (alpha/r) A@B, A ~ N(0, 1/din), B = 0, so step 0 is exactly the base. Only A and B train and have
  optimizer state.
- Trust anchor: train.py hashes the ACTUAL --init-from file (params_sha256 of its p.* arrays; unreadable or empty:
  LORA_BASE_READ) and puts it in cfg as lora.baseSha256, so it is bound by cfgSha256, every save manifest, the
  chain marker and run.json (loraBaseSha256). Resuming a save with another base file is SAVE_CONFIG_MISMATCH; a
  checkpoint whose frozen base (p.*) is not that file is LORA_BASE_MISMATCH, even if its stored cfg was edited to
  name the new file.
- Saves: checkpoint.npz holds the base (p.*) and adapters (l.*); adapter.npz and best-adapter.npz hold only the
  adapters plus lora (with baseSha256) and baseSha256; best.npz is the merged model, so eval and export.py work
  unchanged.
- `python3 peaceai/model/lbtrain.py lora-merge BASE.npz ADAPTER.npz OUT.npz --base-sha SHA` rebuilds the merged
  model (m161: bitwise best.npz). SHA must come from a trusted record (run.json cfg.lora.baseSha256 or a save
  manifest), never from the adapter: without it LORA_BASE_SHA_REQUIRED; the actual BASE file must hash to SHA
  (LORA_BASE_MISMATCH) and the adapter must name SHA (LORA_ADAPTER_MISMATCH), so a swapped base with an edited
  adapter sidecar is refused. It never overwrites OUT.
- The backward pass still computes the full weight gradient and projects it onto A and B: correct, but no compute
  saving on this backend; the saving is in trainable parameters and optimizer state.
- Refusals: LORA_NEEDS_BASE, LORA_BASE_READ, LORA_BAD_RANK, LORA_BAD_ALPHA, LORA_BAD_TARGETS, LORA_SHAPE,
  LORA_SCHEMA, LORA_BASE_MISMATCH, LORA_BASE_SHA_REQUIRED, LORA_ADAPTER_MISMATCH, LORA_OUT_EXISTS.

## M163 first real run (Auditor ruling after #654)

- Route: the existing manual-dispatch workflow `.github/workflows/peace-lm-train.yml`, input `run: lb-first-run`
  (the default `ext-pretrain` runs only the unchanged M37 job). GitHub-hosted `ubuntu-24.04`, environment
  `peaceai-results` (main-branch policy, no required reviewer: a dispatch from main starts without an approval click).
- Main only: the `lb-ref-gate` job fails with LB_RUN_REF_NOT_MAIN on any other ref; the `lb-first-run` job needs it and
  is itself `if: ... github.ref == 'refs/heads/main'`; lb-first-run.sh checks the ref again (`lb_run.py ref`).
- Corpus: `peaceai/bin/lb-corpus-rebuild.sh` (ported from the box recipe that produced the cleared pins) fetches
  PeaceAI-Workspace at b149d9bea430d45792470f0e32657032748af717 by sha (HEAD checked), runs that commit's ext-fetch /
  ext-manifest-check (manifest 8458eac6), the public task-set refs and lb-clean with
  `peaceai/model/lb-hidden-drop-hashes.txt` (byte-identical to main's copy, sha256 ecc97adf...). `lb_run.py pins`
  refuses (LB_RUN_PIN_MISMATCH / LB_RUN_NOT_CLEARED) unless docs, manifest and fingerprint equal lb-train.json
  firstRun.corpus (7eb6c628... / e9f78828... / a3e9165f...) and that corpus is in clearedCorpora.
- Settings: only lb-train.json firstRun.train (no CLI override). `lb_run.py train-argv` refuses LoRA, replay,
  init/resume, saves, markers and kept checkpoints (LB_RUN_FORBIDDEN_SETTING), any flag outside daily.trainArgsAllowed
  or owned by the run (LB_RUN_SETTING_NOT_ALLOWED), and a run without adamw8bit, easy_to_hard and a patience
  (LB_RUN_SETTING_REQUIRED), and (batch 6) one without `--val-split disjoint` (LB_RUN_SETTING_REQUIRED). It appends --deadline = job start + trainDeadlineMin (290) and --max-seconds, refusing
  (LB_RUN_BAD_DEADLINE) unless trainDeadlineMin + reserveMin (40) <= jobTimeoutMin (330, the job's timeout-minutes).
  Model: the M37 ext-train.json size (d 320, 6 layers, ctx 512, vocab 8192, batch 16), steps 1500, eval every 50,
  patience 4, min-delta 0.001.
- Eval: export.py on the run's own held-out split: model bits per byte and the unigram baseline (trained on the train
  split) on the SAME held-out windows. The log verdict is beats_baseline only when held-out bpb < baseline bpb, else
  no_gain; the 4.06 smoke figure is a reference only, the in-run baseline is the comparison.
- Nothing leaves the runner but one row: no artifacts, no cache, no R2; lb-first-run.sh deletes the work, model and
  corpus dirs on exit and the last step removes them again (always). Logs: codes, pins, shas, counts and step metrics.
- Results: `results-write.sh --sparse "/runs/lb-train/<run id>.json"` (new file only, blob verified), after the
  checkout and key-script verify step. `lb_run.py land` writes exactly the fields pins {docs, manifest, fingerprint},
  workflowSha, runId, steps, stopReason, heldoutBpb, baselineBpb, wallSeconds, checkpointSha256 and (batch 6) modelCe,
  heldoutTokens, heldBytes (LB_RUN_ROW_FIELD for any other or missing field, LB_RUN_ROW_VALUE for a bad value,
  LB_RUN_ROW_EXISTS if present). No weights or derived bytes, no latest.json, nothing modified or deleted.
- Bpb inputs (batch 6, Auditor's #660 note): export.py's eval.json now also has model_ce (the unrounded fp16 model
  cross-entropy, nats per token) and held_bytes (UTF-8 bytes of the decoded eval targets) next to heldout_tokens, so
  heldoutBpb = round(modelCe * heldoutTokens / ln 2 / heldBytes, 4) can be recomputed. The row carries all three
  (metrics only), the `lb-run` log line ends with `model_ce= heldout_tokens= held_bytes=`, and lb_run.py refuses a
  row whose inputs do not recompute its heldoutBpb to within 1e-4 (LB_RUN_ROW_VALUE). The row went from 9 to 12
  fields; rows landed before (runs/lb-train/41187515379.json) keep 9 and are only read by the daily LoRA gate.
  The daily row is now schema peaceai-lb-daily-run:v2 with the same three fields and the same recompute check, and
  the `lb-daily` log line ends the same way. New rows are v2 only; v1 rows (landed before this change) are still read
  as part of the trusted record (exactly the v1 fields), never written or landed again.
- v1 cutoff (batch 7, Auditor's #661 and #662 notes): lb_daily.py V1_LAST_RUN_ID = 41222155935, the first daily run
  (dispatched on 08c2383 before v2 merged as ec36fc1), is the only run that can have landed a v1 row. A v1 row is
  trusted history only when runId == "41222155935"; a v1 row with any other runId is refused (guard dr-row-v1-cutoff,
  LB_DAILY_RECORD_BAD from the trusted read). An earlier draft accepted runId <= the cutoff, which let a low-id v1 row
  with a later date (e.g. runId 7, endStep 999) become the resume point (Auditor FAIL at b2bcaad). v2 rows are not
  affected. Every lb_daily.py whole-value pattern ends in \Z, not $ (Python's $ also matches before a trailing newline, so
  "41222155935\n" used to pass ID_RE).
- Tests: m163-lb-first-run.test.ts (each tagged lb_run.py guard killed when disabled, near misses, the workflow shape
  checker with its mutants, the end-to-end run on a tiny corpus).

## Tests

m157-m161 (peaceai/test), the case driver m157-lbtrain-cases.py and the helper m157-lbtrain-mut.ts. Every tagged
guard (`# guard:<name>` in lbtrain.py and daily_cycle.py) has one case; each test disables its guards one at a
time (`if False:`) in a copy of the model dir and requires the case outcome to change. Logic outside the tagged
guards (train.py's stop.json wrapper, stale removal, cfg-match call site and LoRA resume check; the shell's
noclobber line) has text mutants (textMutant in the helper), each required to change the observed outcome.
