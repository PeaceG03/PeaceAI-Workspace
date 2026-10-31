# lm-saves v1 (M148, limit-breaker step 1): rolling saves, verified resume, chained runs

Status: trainer + save/verify/chain code and tests are BUILT (#640). The workflow wiring (R2 storage, chained links)
is BUILT on lb-saves/wire as a draft PR after the storage ruling: R2 (Peace "R2 is fine", 2026-10-30; Auditor gates).
It cannot run until Peace adds the four R2 secrets below to the existing peaceai-results environment; without them it fails closed (R2_NOT_CONFIGURED).

## Model size (measured, not guessed)

- Promoted LM config (ext-train.json; Results lm-v1-858573767465 and lm-v1-088073d41dbc): d_model 320, 6 layers,
  5 heads, ctx 512, vocab 8192, batch 16 -> 10,166,400 parameters.
- fp16 export weights.npz: 20,345,566 bytes.
- Full resume checkpoint.npz (fp32 weights + Adam m + Adam v + meta): 122,035,950 bytes.
- Trimmed best.npz in a save (meta + fp32 weights only): 40,678,846 bytes.
- One save is about 163 MB; the local keep-2 is about 326 MB (the bucket is add-only and grows by one save per upload). (The retrain default 384/6/6/256/4096 would be 12,297,984 params.)

## Trainer (peaceai/model/train.py + peaceai/model/saves.py)

- Opt-in: nothing changes unless --save-dir is given (peace-lm-train / retrain behaviour is untouched).
- --save-every-min N (default 20): after a step, if N minutes passed since the last save, write a save. A save is
  checkpoint.npz (weights, Adam moments, step, t, RNG state), tokenizer.json, metrics.jsonl and, when present,
  best.json, trimmed best.npz, replay.json, val.json. The data position is the RNG state: batch offsets are drawn
  from it, and the token streams are rebuilt deterministically from the restored tokenizer and the same corpus.
- Atomic: files go to saves/.tmp-save-NNNNNNNNN-PID, are fsynced, a manifest.json is written (schema, step, cfg,
  cfgSha256, dataSha256 = sha256 of the corpus/replay files, and sha256 + bytes per file), then one rename makes the
  save visible. The manifest file's sha256 is the save's identity. Only the latest 2 saves are kept in the local
  saves dir on the runner (the bucket is add-only, below); stale .tmp dirs are removed.
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
saves.py verify and decide use the standard library only (the checkpoint meta is read with zipfile and the .npy
header, npz_meta), so they run without numpy; the tests run them, and lb_run.py, lb_daily.py and daily_cycle.py,
with numpy blocked (peaceai/test/nonumpy.ts; #657).

## Workflow wiring (peace-lm-train.yml, built; Auditor gates)

Ruling: R2 under Auditor's terms (instead of the earlier artifact / encryption / in-job-only options). Artifacts stay banned for
weights (m9 / m31 / m37 also ban download-artifact and actions/cache for this workflow); Results cannot hold rolling
saves (100 MB file limit vs a 122 MB checkpoint, delete-nothing rule).

Peace adds (the values never go in chat, logs or the repo):
  - No new environment (Auditor, #643 review): the train job stays on the existing environment peaceai-results
    (deployment branches: main only). PEACEAI_RESULTS_DEPLOY_KEY stays as is.
  - Four new environment secrets in peaceai-results:
      LM_SAVES_R2_ACCOUNT_ID         Cloudflare account id (32 hex)
      LM_SAVES_R2_ACCESS_KEY_ID      R2 API token access key id
      LM_SAVES_R2_SECRET_ACCESS_KEY  R2 API token secret access key
      LM_SAVES_R2_BUCKET             bucket name (one private bucket used only for these saves)
  - The R2 API token: "Object Read & Write", scoped to that one bucket only, no account-level permission.

Job train (environment peaceai-results, contents: read, timeout-minutes 355):
  1. Job clock: JOB_START; the soft deadline is JOB_START + 340 min (train.py --job-start / --soft-deadline-min).
  2. Chain inputs and storage check, BEFORE the corpus fetch and training: chain_index 0-99 below max_chain 1-12
     (CHAIN_BAD_ARGS), lm-saves-r2.sh check (R2_NOT_CONFIGURED if any of the four secrets is missing or malformed,
     R2_TOOL_MISSING without aws). Link 0 takes no resume inputs and its chain id is its own run id. A later link
     needs chain_id, resume_save (save-NNNNNNNNN) and resume_manifest_sha (64 lowercase hex), else
     RESUME_INPUTS_BAD; it downloads lm-saves/<chain>/<save>/ (R2_GET_FAILED) and passes
     --resume-from <download> --resume-manifest-sha <the INPUT sha> to train.py. The expected sha never comes from
     the bucket; train.py verifies the manifest's sha256, the exact file set and every file's sha256 and size before
     loading anything, and refuses with one code (no fresh start).
  3. Train: train.py --save-dir --save-every-min 20 --job-start --soft-deadline-min 340 --marker, run under
     env -u for the four R2 variables (training never sees the credentials). A background loop calls
     lm-saves-r2.sh put every 60 s, so each 20-min save reaches R2 while the job runs (crash / timeout safe).
  4. Copy the remaining saves to R2 (if: always()): one line per save "R2_PUT save=<name> manifest=<sha256>" - this
     job-log line is the trusted record for a manual resume after a crash (dispatch with chain_id, chain_index,
     resume_save and resume_manifest_sha copied from it).
  5. Chain decision (id decide): saves.py decide on the local marker and save (verified); a next link also needs
     the save to be one this job uploaded (R2_SAVE_NOT_UPLOADED). Outputs next, chain_id, index, max_chain, save, sha.
     No next link (done, or at the cap) sets FINAL_LINK.
  6-8. Export, set C v2 eval and the Results landing run only on the last link (if: env.FINAL_LINK == 'yes').

Job chain (needs train, only if next == yes; no checkout, no environment, no secret; permissions actions: write only,
the peace-verdict.yml mechanism; timeout 5): re-validates the five outputs and runs
gh workflow run peace-lm-train.yml --ref main -f chain_id -f chain_index -f max_chain -f resume_save
-f resume_manifest_sha. A dispatched link queues behind the running one (concurrency group, no cancel).

Bucket layout (lm-saves-r2.sh): lm-saves/<chain id>/save-NNNNNNNNN/<file>, manifest.json uploaded last (a save
without its manifest is not fetched and cannot verify). The bucket is add-only (Auditor, #657): nothing is ever
removed or overwritten, and a save name that already exists under the chain is refused before any upload
(R2_SAVE_EXISTS; s3 cp would silently overwrite it; a listing error is R2_LIST_FAILED). Nothing outside
lm-saves/<chain id>/ is touched. The endpoint is built from the account id in
the environment (AWS_ENDPOINT_URL), never on a command line; all aws output goes to /dev/null; every printed line is
a code, a save name, a step or a sha256. Every save of every chain stays until Peace removes it by hand.

Codes: R2_NOT_CONFIGURED, R2_TOOL_MISSING, R2_BAD_ARGS, R2_PUT_FAILED, R2_PUT_REFUSED, R2_PUT_SKIPPED, R2_SAVE_EXISTS, R2_LIST_FAILED,
R2_GET_FAILED, R2_SAVE_NOT_UPLOADED, CHAIN_BAD_ARGS, RESUME_INPUTS_BAD, CHAIN_DISPATCH_FAILED, CHAIN_LINE_BAD, plus the
saves.py SAVE_* / CHAIN_* codes above.

Tests: m148-lm-saves.test.ts runs lm-saves-r2.sh against a fake aws (no delete call, an existing name refused, manifest last, endpoint only in the
environment, quiet output, every refusal) and runs the storage-check, chain-decision and dispatch steps' own scripts
(extracted from the workflow) with fake aws / gh; m9 pins the workflow sha and its exact secret set; m37 pins the
soft deadline.

Not built (rules): no hourly backup-check routine (standing "no check or sweep routines" rule); no paid compute; the
workflow has not been run; latest.json, promotion and the stage-2 flag are untouched.

## Folders and put-one (M165)

lm-saves-r2.sh takes an optional leading `--folder lm-saves|lb-daily` (default lm-saves; anything else is
R2_BAD_ARGS); every key is `<folder>/<chain>/<save>/`. peace-lm-train.yml keeps the default; the lb-train daily
cycle (peace-lb-daily.yml) uses lb-daily only. `put-one CHAIN DIR SAVE SHA` uploads one save only if its
manifest hashes to SHA (R2_SHA_MISMATCH) and the name is not in the bucket yet (R2_SAVE_EXISTS), the manifest last;
it removes nothing, so every earlier save (including the trusted resume point) stays.
