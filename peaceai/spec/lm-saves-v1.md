# lm-saves v1 (M148, limit-breaker step 1): rolling saves, verified resume, chained runs

Status: trainer + save/verify/chain code and tests are BUILT in this PR. The workflow wiring below is a DRAFT only:
it needs Auditor and Peace to rule on storage and permissions before any workflow file changes (separate workflow PR).

## Model size (measured, not guessed)

- Promoted LM config (ext-train.json; Results lm-v1-858573767465 and lm-v1-088073d41dbc): d_model 320, 6 layers,
  5 heads, ctx 512, vocab 8192, batch 16 -> 10,166,400 parameters.
- fp16 export weights.npz: 20,345,566 bytes.
- Full resume checkpoint.npz (fp32 weights + Adam m + Adam v + meta): 122,035,950 bytes.
- Trimmed best.npz in a save (meta + fp32 weights only): 40,678,846 bytes.
- One save is about 163 MB; keep-2 is about 326 MB. (The retrain default 384/6/6/256/4096 would be 12,297,984 params.)

## Trainer (peaceai/model/train.py + peaceai/model/saves.py)

- Opt-in: nothing changes unless --save-dir is given (peace-lm-train / retrain behaviour is untouched).
- --save-every-min N (default 20): after a step, if N minutes passed since the last save, write a save. A save is
  checkpoint.npz (weights, Adam moments, step, t, RNG state), tokenizer.json, metrics.jsonl and, when present,
  best.json, trimmed best.npz, replay.json, val.json. The data position is the RNG state: batch offsets are drawn
  from it, and the token streams are rebuilt deterministically from the restored tokenizer and the same corpus.
- Atomic: files go to saves/.tmp-save-NNNNNNNNN-PID, are fsynced, a manifest.json is written (schema, step, cfg,
  cfgSha256, dataSha256 = sha256 of the corpus/replay files, and sha256 + bytes per file), then one rename makes the
  save visible. The manifest file's sha256 is the save's identity. Only the latest 2 saves are kept; stale .tmp
  dirs are removed.
- --job-start EPOCH + --soft-deadline-min M (default 340 = 5h40m): sets the existing --deadline, so training stops
  before a step that would not finish in time, saves, and with --marker writes chain.json:
  {schema peaceai-lm-chain:v1, more, stopReason, step, totalSteps, save, manifestSha256, cfgSha256}. more is true
  only for deadline / max_seconds / max_steps_this_run.
- Logs are one ASCII line each: "save step=N name=save-N", "marker more=yes|no stop=R step=N", "resumed step=N".

## Resume (fail closed)

--resume-from DIR --resume-manifest-sha SHA. Before anything is read: the manifest sha must match, the schema and
file set must be exact (no extra, missing or symlinked file), every file's bytes and sha256 must match, and the
checkpoint's step and cfg must equal the manifest's. Files are re-hashed after copying. Then the run's full config
(total_steps included) and data sha must equal the save's. Any failure exits non-zero with one code and leaves no
resumable checkpoint behind: SAVE_SHA_REQUIRED, SAVE_MISSING, SAVE_MANIFEST_SHA, SAVE_SCHEMA, SAVE_FILE_SET,
SAVE_FILE_SHA, SAVE_CHECKPOINT, SAVE_CONFIG_MISMATCH, SAVE_DATA_MISMATCH, RESUME_WORK_NOT_EMPTY,
RESUME_WITH_INIT_FROM. There is no fallback to a fresh start. Tested: 4 steps + resume to 6 equals the uninterrupted
6-step run bitwise (params, m, v, meta) and in every logged loss / lr / grad norm.

## Chain decision

saves.py decide MARKER SAVES_DIR INDEX MAX prints one line: "chain next=yes index=I+1 ..." or
"chain next=no reason=done|cap", or exits 3 with CHAIN_BAD_ARGS, CHAIN_MAX_TOO_LARGE (MAX > 12), CHAIN_NO_MARKER,
CHAIN_SAVE_BAD (bad save name) or CHAIN_SAVE_BAD:<verify code> (missing / corrupted save, marker not matching it).

## Workflow wiring (DRAFT, needs Auditor and Peace)

Storage conflict: the brief says Actions artifacts. This repo is public and its tests and headers forbid model
artifacts (m9 pins peace-lm-train.yml and bans upload-artifact; m31 "weights never become a public artifact"; m37;
the retrain pin bans upload-artifact, download-artifact and actions/cache). Public-repo artifacts are downloadable by
any signed-in GitHub user, so a save artifact publishes the weights. Results cannot hold rolling saves (100 MB file
limit vs a 122 MB checkpoint, and "delete nothing in Results"). Options for the ruling:
  A. Accept artifacts for saves (weights become public while retained; set retention-days 1-2) and relax the m9 /
     m31 / m37 / m119 artifact bans for the save artifact name only.
  B. Encrypt the save before upload with a key Peace adds as a secret (needs a new secret: excluded by the brief).
  C. Keep chaining off; use saves only within one job (crash-safe to the last 20 min, no cross-run resume).
Permissions: the chain job needs GITHUB_TOKEN actions: write (the same mechanism peace-verdict.yml already uses for
gh workflow run) and the resume job needs actions: read to download the previous run's artifact. Timeout: the
train job's timeout-minutes must exceed 340 (e.g. 355); the existing --max-seconds 14400 pin (m37) changes to the
soft deadline.

Draft for peace-lm-train.yml (option A), not applied:

    on:
      workflow_dispatch:
        inputs:
          resume_run_id: { description: "run id holding the save to resume (empty = fresh)", default: "" }
          chain_index:   { description: "this link's index (0 = first)", default: "0" }
          max_chain:     { description: "max links (1-12)", default: "4" }
    jobs:
      train:
        timeout-minutes: 355
        permissions: { contents: read, actions: read }
        steps:
          - name: Job clock
            run: echo "JOB_START=$(date +%s)" >> "$GITHUB_ENV"
          # ... checkout, install, fetch, manifest check as today ...
          - name: Fetch the previous link's save (refused if missing)
            if: inputs.resume_run_id != ''
            env: { GH_TOKEN: "${{ github.token }}", RID: "${{ inputs.resume_run_id }}" }
            run: |
              [[ "$RID" =~ ^[0-9]{1,20}$ ]] || { echo "CHAIN_BAD_RUN_ID"; exit 1; }
              gh run download "$RID" --repo "$GITHUB_REPOSITORY" --name lm-save --dir "$RUNNER_TEMP/prev" > /dev/null 2>&1 \
                || { echo "CHAIN_SAVE_BAD:SAVE_MISSING"; exit 1; }
              m="$RUNNER_TEMP/prev/chain.json"; test -f "$m" || { echo "CHAIN_NO_MARKER"; exit 1; }
              echo "RESUME_ARGS=--resume-from $RUNNER_TEMP/prev/saves/$(jq -r .save "$m") --resume-manifest-sha $(jq -r .manifestSha256 "$m")" >> "$GITHUB_ENV"
          - name: Train
            run: |
              "$py" peaceai/model/train.py ...same model flags... --save-dir "$RUNNER_TEMP/work/saves" \
                --job-start "$JOB_START" --soft-deadline-min 340 --save-every-min 20 --marker "$RUNNER_TEMP/work/chain.json" \
                $RESUME_ARGS > "$RUNNER_TEMP/train.log" 2>&1 || { echo "train failed exit=$?"; exit 1; }
              grep -E '^(params=|resumed |save |marker |stopped )' "$RUNNER_TEMP/train.log" || true
          - name: Keep the latest save (also after a crash or timeout: the last 20-min save survives)
            if: always()
            uses: actions/upload-artifact@<pinned sha>
            with: { name: lm-save, path: "${{ runner.temp }}/work/saves\n${{ runner.temp }}/work/chain.json", retention-days: 2, if-no-files-found: ignore }
          # export + land in Results ONLY when chain.json says more=false (the final link)
      chain:
        needs: train
        permissions: { actions: write }
        steps:
          - uses: actions/checkout@<pinned sha>
          - uses: actions/download-artifact@<pinned sha>
            with: { name: lm-save, path: "${{ runner.temp }}/s" }
          - name: Next link (one line; refuses a missing save or a chain at its cap)
            env: { GH_TOKEN: "${{ github.token }}", IDX: "${{ inputs.chain_index }}", MAX: "${{ inputs.max_chain }}" }
            run: |
              line=$(python3 peaceai/model/saves.py decide "$RUNNER_TEMP/s/chain.json" "$RUNNER_TEMP/s/saves" "$IDX" "$MAX") || { echo "chain refused"; exit 1; }
              echo "$line"
              case "$line" in "chain next=yes "*) ;; *) exit 0;; esac
              gh workflow run peace-lm-train.yml --repo "$GITHUB_REPOSITORY" --ref main \
                -f resume_run_id="$GITHUB_RUN_ID" -f chain_index=$((IDX + 1)) -f max_chain="$MAX"

Not built (rules): no hourly backup-check routine (standing "no check or sweep routines" rule); no R2, no new
secret, no paid compute; latest.json, promotion and Results are untouched; the stage-2 flag stays off.
