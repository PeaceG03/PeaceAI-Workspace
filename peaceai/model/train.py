"""M9 training: self-trained BPE tokenizer + from-scratch transformer, seeded, CPU only, resumable.

Usage: train.py --corpus DIR --work DIR [--steps N] [--max-seconds S] [--threads K] [--seed N]
       [--replay-corpus RDIR [--replay-frac F] [--val-windows N] --val-seed S] [--keep-checkpoints]
Reads DIR/docs.jsonl and DIR/manifest.jsonl (from peaceai/bin/lm-corpus.ts). Writes into --work only:
tokenizer.json, tokens_*.npy, checkpoint.npz (fp32 weights + AdamW state + RNG state), metrics.jsonl.
Prints step metrics only (no corpus text). Run it somewhere private when the corpus holds private code.

LM retrain replay (forgetting fix after run 40375535718; peaceai/model/replay.py holds the shared rules):
  --replay-corpus RDIR  docs.jsonl + manifest.jsonl of general code from the live model's own pretrain manifest
                        (lm-retrain-replay.sh). Its split=train docs are replayed; its split=heldout docs are the
                        ONLY validation data: early stopping and best.json read val windows from them, never --corpus
                        heldout docs (the fine-tune split is by file path and is not used for selection).
  --replay-frac F       share of every batch drawn from the replay train docs: replay.replay_rows(batch, F) rows
                        (default 0.75); the other rows come from --corpus split=train. Each step's record carries
                        replay_rows and ft_rows as built.
  --val-windows N       replay.val_windows: ctx+1 tokens of each of the first N heldout docs that are long enough, one
                        window per doc (default 64), starting at replay.val_offset (seeded by --val-seed and the doc
                        id, clamped to fit). Writes val.json {docs, windows, sha256, seed} into --work.
  --val-seed S          the window-offset seed (lm-retrain.json finetune.valSeed); required with --replay-corpus.
  --keep-checkpoints    copy checkpoint.npz to ckpt-<step>.npz at every eval (the retrain dry run scores each one on
                        set C v2 AFTER training; train.py itself never reads set C or any judge item).
  --deadline EPOCH      (LM retrain, pretrain mode) a wall-clock deadline in Unix seconds: no step is started unless
                        it, and its eval when one is due, is expected to finish before it (2x the slowest step and the
                        slowest eval seen so far). With --max-seconds, the loop ends cleanly at the last completed step,
                        so a job's time limit never kills a run with nothing written. 0 = none.
M148 limit-breaker saves (peaceai/model/saves.py holds the rules; spec peaceai/spec/lm-saves-v1.md):
  --save-dir DIR        full resume saves (weights + AdamW state + step + RNG/data position + tokenizer, metrics, best)
                        every --save-every-min minutes (default 20) at a step boundary and once at the end; atomic,
                        sha256 manifest per save, only the latest 2 kept. Off when --save-dir is not given.
  --job-start EPOCH     with --save-dir and no --deadline: the soft deadline is EPOCH + --soft-deadline-min (default 340
                        = 5h40m), so the run saves and exits cleanly before the 6 h job limit.
  --marker FILE         chain.json {more, stopReason, step, save, manifestSha256}: more is true when the run stopped on
                        time (deadline, max_seconds) or max_steps_this_run, i.e. there is more to do.
  --resume-from DIR --resume-manifest-sha SHA
                        resume from a save: the manifest sha256, every file, the checkpoint step, the config and the
                        training data are verified first; any mismatch exits with one SAVE_* code (never a fresh start).
Every run writes timing.json {setupSeconds, trainSeconds, evalSeconds, steps, stoppedStep, bestStep, stopReason
("steps" | "patience" | "max_steps_this_run" | "max_seconds" | "deadline" | "nonfinite"), timeCut (max_seconds or deadline)}.
Limit-breaker steps 3-7 (M157-M161; peaceai/model/lbtrain.py holds the rules; spec peaceai/spec/lb-train-v1.md). All
off by default; when on, each is recorded in the config (so in every save manifest and the resume check):
  --precision fp32|bf16|auto     bf16 = emulated mixed precision (bf16 compute copy of the weight matrices, fp32
                                 master weights); auto = fp32 here (numpy has no native bf16). Default fp32.
  --optimizer adamw|adamw8bit    adamw8bit = block-wise 8-bit Adam moments between steps. Default adamw.
  --curriculum easy_to_hard [--curriculum-start F] [--curriculum-ramp N] [--curriculum-seed S]
                                 docs ordered by lb-clean difficulty.score (manifest), batches drawn from the easiest
                                 prefix growing from F to all of it at step N (default steps // 2). Not with replay.
  --min-delta D                  with --patience: an eval improves only when lower than best by more than D.
  --lora-rank R [--lora-alpha A] [--lora-targets wqkv,wo]
                                 LoRA on frozen --init-from weights; adapter.npz / best-adapter.npz saved separately,
                                 best.npz is the merged model (export reads it unchanged).
Every run writes run.json (fingerprint: cfg, cfgSha256, dataSha256, precision, optimizer, curriculum, lora, stop
rule) and stop.json (reason, step, bestStep, bestVal, lastVal, stale, patience, minDelta, budget)."""
import argparse
import json
import os
import sys
import time

ap = argparse.ArgumentParser()
ap.add_argument("--corpus", required=True)
ap.add_argument("--work", required=True)
ap.add_argument("--steps", type=int, default=600)
ap.add_argument("--max-seconds", type=float, default=1e9)
ap.add_argument("--max-steps-this-run", type=int, default=0)  # stop early (resume later); 0 = no limit
ap.add_argument("--threads", type=int, default=8)
ap.add_argument("--seed", type=int, default=20261010)
ap.add_argument("--batch", type=int, default=16)
ap.add_argument("--eval-every", type=int, default=50)
ap.add_argument("--d-model", type=int, default=384)
ap.add_argument("--n-layer", type=int, default=6)
ap.add_argument("--n-head", type=int, default=6)
ap.add_argument("--ctx", type=int, default=256)
ap.add_argument("--vocab", type=int, default=4096)
ap.add_argument("--lr", type=float, default=6e-4)
ap.add_argument("--warmup", type=int, default=30)
# M49 fine-tune stage: start from these weights (p.* arrays of a checkpoint/best .npz with the same model shape);
# fresh optimizer state. Ignored when the work dir already has a checkpoint (resume wins).
ap.add_argument("--init-from", default="")
ap.add_argument("--patience", type=int, default=0)  # early stop after N evals without a held-out improvement; 0 = off
ap.add_argument("--replay-corpus", default="")
ap.add_argument("--replay-frac", type=float, default=0.75)
ap.add_argument("--val-windows", type=int, default=64)
ap.add_argument("--val-seed", default=None)
ap.add_argument("--keep-checkpoints", action="store_true")
ap.add_argument("--deadline", type=float, default=0.0)
ap.add_argument("--save-dir", default="")
ap.add_argument("--save-every-min", type=float, default=20.0)
ap.add_argument("--job-start", type=float, default=0.0)
ap.add_argument("--soft-deadline-min", type=float, default=340.0)
ap.add_argument("--marker", default="")
ap.add_argument("--resume-from", default="")
ap.add_argument("--resume-manifest-sha", default="")
ap.add_argument("--precision", default="fp32")
ap.add_argument("--optimizer", default="adamw")
ap.add_argument("--curriculum", default="")
ap.add_argument("--curriculum-start", type=float, default=0.25)
ap.add_argument("--curriculum-ramp", type=int, default=0)  # 0 = steps // 2
ap.add_argument("--curriculum-seed", default=None)  # default: --seed
ap.add_argument("--min-delta", type=float, default=0.0)
ap.add_argument("--lora-rank", type=int, default=0)  # 0 = off
ap.add_argument("--lora-alpha", type=float, default=0.0)  # 0 = the rank (scale 1)
ap.add_argument("--lora-targets", default="wqkv,wo")
args = ap.parse_args()
for v in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[v] = str(args.threads)

import numpy as np  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lm  # noqa: E402
import replay  # noqa: E402
import saves  # noqa: E402
import lbtrain  # noqa: E402

try:  # M157-M159 argument checks, before anything is read or written
    PREC = lbtrain.resolve_precision(args.precision)
    OPT = args.optimizer
    lbtrain.opt_init({}, OPT)
    CCFG = lbtrain.curriculum_cfg(args.curriculum, args.curriculum_start, args.curriculum_ramp or max(1, args.steps // 2),
                                  args.curriculum_seed if args.curriculum_seed is not None else str(args.seed), bool(args.replay_corpus))
    lbtrain.check_stop_args(args.patience, args.min_delta)
except lbtrain.LbError as e:
    raise SystemExit(e.code)

os.makedirs(args.work, exist_ok=True)
W = lambda name: os.path.join(args.work, name)  # noqa: E731
t0 = time.time()
RESUME_MAN = None
if args.resume_from:
    # M148: verify the save (manifest sha256, every file, checkpoint step) BEFORE anything is read or trained;
    # config and data are checked against it below, once they are known. Any failure: one code, no fresh start.
    if args.init_from:
        raise SystemExit("RESUME_WITH_INIT_FROM")
    try:
        RESUME_MAN = saves.restore(args.resume_from, args.work, saves.verify_save(args.resume_from, args.resume_manifest_sha))
    except saves.SaveError as e:
        raise SystemExit(e.code)
if args.marker and not args.save_dir:
    raise SystemExit("MARKER_NEEDS_SAVE_DIR")
if args.save_dir and args.job_start and not args.deadline:
    args.deadline = args.job_start + args.soft_deadline_min * 60.0


def read_corpus(d):
    texts, sp = {}, {}
    with open(os.path.join(d, "docs.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                texts[o["doc"]] = o["text"]
    with open(os.path.join(d, "manifest.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                sp[o["doc"]] = o["split"]
    return texts, sp


def read_scores(d):
    """M158: lb-clean's difficulty.score per doc from the manifest (None when a line has none)."""
    out = {}
    with open(os.path.join(d, "manifest.jsonl"), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                o = json.loads(line)
                dif = o.get("difficulty")
                out[o["doc"]] = dif.get("score") if isinstance(dif, dict) else None
    return out


docs, split = read_corpus(args.corpus)
train_ids = sorted(i for i in docs if split[i] == "train")
held_ids = sorted(i for i in docs if split[i] == "heldout")
REPLAY = bool(args.replay_corpus)
if REPLAY:
    rdocs, rsplit = read_corpus(args.replay_corpus)
    if set(rdocs) != set(rsplit):
        raise SystemExit("REPLAY_CORPUS_MISMATCH")
    replay_ids = sorted(i for i in rdocs if rsplit[i] == "train")
    val_ids = sorted(i for i in rdocs if rsplit[i] == "heldout")
    if not replay_ids or not val_ids:
        raise SystemExit("REPLAY_SPLIT_EMPTY")

if not os.path.exists(W("tokenizer.json")):
    spec = lm.train_bpe([docs[i] for i in train_ids], args.vocab)  # held-out files never train the tokenizer
    with open(W("tokenizer.json"), "w") as f:
        f.write(lm.canonical(spec) + "\n")
    print(f"tokenizer trained merges={len(spec['merges'])} seconds={time.time() - t0:.0f}", flush=True)
tok = lm.Tokenizer(json.load(open(W("tokenizer.json"))))


def stream(ids, name):
    path = W(f"tokens_{name}.npy")
    if os.path.exists(path):
        return np.load(path)
    out = []
    for i in ids:
        out.extend(tok.encode(docs[i]))
        out.append(lm.EOD)
    arr = np.array(out, np.uint16)
    np.save(path, arr)
    return arr


train_tok = stream(train_ids, "train")
held_tok = stream(held_ids, "heldout") if not REPLAY else None  # with replay the fine-tune heldout docs are never read
train_bytes = sum(len(docs[i].encode()) for i in train_ids)
if REPLAY:
    path = W("tokens_replay.npy")
    if os.path.exists(path):
        replay_tok = np.load(path)
    else:
        out = []
        for i in replay_ids:
            out.extend(tok.encode(rdocs[i]))
            out.append(lm.EOD)
        replay_tok = np.array(out, np.uint16)
        np.save(path, replay_tok)
    print(f"tokens train={len(train_tok)} replay={len(replay_tok)} val_docs={len(val_ids)} bytes_per_token={train_bytes / max(1, len(train_tok)):.2f}", flush=True)
else:
    print(f"tokens train={len(train_tok)} heldout={len(held_tok)} bytes_per_token={train_bytes / len(train_tok):.2f}", flush=True)
if CCFG:
    # M158: sample from the easy-to-hard re-laid stream (tokens_train.npy on disk keeps the id order for export.py)
    try:
        train_tok = lbtrain.reorder_stream(train_tok, train_ids, lbtrain.order_easy_to_hard(train_ids, read_scores(args.corpus), CCFG["seed"]), lm.EOD)
    except lbtrain.LbError as e:
        raise SystemExit(e.code)
    print(f"curriculum easy_to_hard start={CCFG['start']} ramp={CCFG['ramp']}", flush=True)

cfg = {"schema": lm.MODEL_SCHEMA, "d_model": args.d_model, "n_head": args.n_head, "n_layer": args.n_layer,
       "vocab_size": args.vocab, "ctx": args.ctx, "lr": args.lr, "warmup": args.warmup, "total_steps": args.steps,
       "batch": args.batch, "weight_decay": 0.1, "grad_clip": 1.0, "seed": args.seed}
# M157/M158/M161: recorded only when on, so a default config (and every existing save) is unchanged
if PREC != "fp32":
    cfg["precision"] = PREC
if OPT != "adamw":
    cfg["optimizer"] = OPT
if CCFG:
    cfg["curriculum"] = CCFG
try:
    LCFG = lbtrain.lora_cfg(args.lora_rank, args.lora_alpha or float(args.lora_rank), args.lora_targets, args.init_from,
                            os.path.exists(W("checkpoint.npz")), cfg)
except lbtrain.LbError as e:
    if RESUME_MAN is not None:
        saves.unrestore(RESUME_MAN, args.work)
    raise SystemExit(e.code)
if LCFG:
    cfg["lora"] = LCFG
T, B = cfg["ctx"], cfg["batch"]
DATA_FILES = [os.path.join(args.corpus, "docs.jsonl"), os.path.join(args.corpus, "manifest.jsonl")]
if REPLAY:
    DATA_FILES += [os.path.join(args.replay_corpus, "docs.jsonl"), os.path.join(args.replay_corpus, "manifest.jsonl")]
DATA_SHA = saves.data_sha256(DATA_FILES) if (args.save_dir or RESUME_MAN) else None
if RESUME_MAN is not None:
    try:
        saves.check_identity(RESUME_MAN, cfg, DATA_SHA)
    except saves.SaveError as e:
        saves.unrestore(RESUME_MAN, args.work)  # a refused save leaves nothing behind to be resumed by accident
        raise SystemExit(e.code)

if REPLAY:
    # Validation = replay heldout docs only: one window per doc over val-windows distinct docs (replay.val_windows).
    if not args.val_seed:
        raise SystemExit("REPLAY_REFUSED: --val-seed is required with --replay-corpus")
    try:
        k_replay = replay.replay_rows(B, args.replay_frac)
        wins = replay.val_windows([(i, tok.encode(rdocs[i]) + [lm.EOD]) for i in val_ids], T, args.val_windows, args.val_seed)
    except ValueError as e:
        raise SystemExit(f"REPLAY_REFUSED: {e}")
    if k_replay and len(replay_tok) < T + 2:
        raise SystemExit("REPLAY_TOO_SHORT")
    if k_replay < B and len(train_tok) < T + 2:
        raise SystemExit("FT_TOO_SHORT")
    vrec = {"docs": len({d for d, _ in wins}), "windows": len(wins), "sha256": replay.windows_sha(wins), "seed": args.val_seed}
    rrec = {"replayFrac": args.replay_frac, "replayRows": k_replay, "ftRows": B - k_replay, "replayTokens": int(len(replay_tok)), "ftTokens": int(len(train_tok)), "val": vrec}
    if os.path.exists(W("replay.json")) and json.load(open(W("replay.json"))) != rrec:
        raise SystemExit("REPLAY_CONFIG_MISMATCH")
    json.dump(rrec, open(W("replay.json"), "w"), sort_keys=True)
    json.dump(vrec, open(W("val.json"), "w"), sort_keys=True)
    n_eval = len(wins)
    # export.py's eval.json reads tokens_heldout.npy: with replay it is these same pretrain-heldout windows, concatenated.
    np.save(W("tokens_heldout.npy"), np.array([t for _, w in wins for t in w], np.uint16))
    eval_x = np.array([w[:T] for _, w in wins], np.int64)
    eval_y = np.array([w[1:T + 1] for _, w in wins], np.int64)
    print(f"replay rows={k_replay} ft rows={B - k_replay} of batch={B} (frac={args.replay_frac}); val windows={vrec['windows']} docs={vrec['docs']}", flush=True)
else:
    k_replay = 0
    # Fixed held-out evaluation windows (non-overlapping, deterministic).
    n_eval = min(16, max(1, (len(held_tok) - 1) // T))
    eval_x = np.stack([held_tok[i * T: i * T + T] for i in range(n_eval)]).astype(np.int64)
    eval_y = np.stack([held_tok[i * T + 1: i * T + T + 1] for i in range(n_eval)]).astype(np.int64)

if os.path.exists(W("checkpoint.npz")):
    with np.load(W("checkpoint.npz"), allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        if lm.canonical({k: meta["cfg"][k] for k in cfg if k != "total_steps"}) != lm.canonical({k: cfg[k] for k in cfg if k != "total_steps"}):
            raise SystemExit("CHECKPOINT_CONFIG_MISMATCH")
        params = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}
        lora = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("l.")} if LCFG else None
        try:
            if LCFG:
                lbtrain.lora_check(params, lora, LCFG)
            state = lbtrain.opt_load(z, meta["t"], lora if LCFG else params, OPT)
        except lbtrain.LbError as e:
            raise SystemExit(e.code)
    BASE_SHA = meta.get("loraBaseSha256")
    if LCFG and lbtrain.params_sha256(params) != BASE_SHA:  # M161: the frozen base is the one the adapters were trained on
        raise SystemExit("LORA_BASE_MISMATCH")
    rng = np.random.Generator(np.random.PCG64())
    rng.bit_generator.state = meta["rng"]
    step = meta["step"]
    print(f"resumed step={step}", flush=True)
else:
    params = lm.init_params(cfg, args.seed)
    if args.init_from:
        with np.load(args.init_from, allow_pickle=False) as z:
            init = {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}
        if sorted(init) != sorted(params) or any(init[k].shape != params[k].shape for k in params):
            raise SystemExit("INIT_SHAPE_MISMATCH")
        params = init
        print("initialized from weights", flush=True)
    BASE_SHA = lbtrain.params_sha256(params) if LCFG else None
    lora = lbtrain.lora_init(params, LCFG, args.seed) if LCFG else None
    state = lbtrain.opt_init(lora if LCFG else params, OPT)
    rng = np.random.Generator(np.random.PCG64(args.seed + 1))
    step = 0
trainable = lora if LCFG else params
STEP_FN = lbtrain.adamw8_step if OPT == "adamw8bit" else lm.adamw_step
RUN_DATA_SHA = DATA_SHA or saves.data_sha256(DATA_FILES)
STOP_RULE = {"patience": args.patience, "minDelta": args.min_delta, "steps": args.steps, "maxSeconds": args.max_seconds,
             "maxStepsThisRun": args.max_steps_this_run, "evalEvery": args.eval_every}
with open(W("run.json"), "w") as f:
    f.write(lbtrain.canonical(lbtrain.run_record(cfg, RUN_DATA_SHA, STOP_RULE, BASE_SHA)) + "\n")
if LCFG or OPT != "adamw" or PREC != "fp32":
    print(f"precision={PREC} optimizer={OPT} opt_state_bytes={lbtrain.opt_state_bytes(state)}" + (f" lora rank={LCFG['rank']} targets={','.join(LCFG['targets'])} trainable={sum(v.size for v in lora.values())}" if LCFG else ""), flush=True)
print(f"params={lm.param_count(cfg)} d={cfg['d_model']} layers={cfg['n_layer']} heads={cfg['n_head']} ctx={T} vocab={cfg['vocab_size']} threads={args.threads}", flush=True)


def eval_params():
    return lbtrain.lora_effective(params, lora, LCFG) if LCFG else params


def eval_loss():
    tot = 0.0
    ep = eval_params()
    for i in range(0, n_eval, 4):
        tot += lm.forward(ep, cfg, eval_x[i:i + 4], eval_y[i:i + 4])[1] * len(eval_x[i:i + 4])
    return tot / n_eval


def log(rec):
    with open(W("metrics.jsonl"), "a") as f:
        f.write(json.dumps(rec) + "\n")
    print(json.dumps(rec), flush=True)


def save():
    meta = {"cfg": cfg, "t": state["t"], "step": step, "rng": rng.bit_generator.state}
    if LCFG:
        meta["loraBaseSha256"] = BASE_SHA
    arrays = {f"p.{k}": params[k] for k in params}
    if LCFG:
        arrays.update({f"l.{k}": lora[k] for k in lora})
    arrays.update(lbtrain.opt_arrays(state, list(trainable)))
    np.savez(W("checkpoint.tmp.npz"), meta=np.array(json.dumps(meta)), **arrays)
    os.replace(W("checkpoint.tmp.npz"), W("checkpoint.npz"))
    if LCFG:
        lbtrain.save_adapter(W("adapter.npz"), lora, LCFG, BASE_SHA, step)


def save_best_merged():
    """M161: best.npz = the merged model (meta + p.*) so export/eval read it unchanged; the adapter goes separately."""
    ep = eval_params()
    meta = {"cfg": cfg, "t": state["t"], "step": step, "rng": rng.bit_generator.state, "loraBaseSha256": BASE_SHA}
    np.savez(W("best.tmp.npz"), meta=np.array(json.dumps(meta)), **{f"p.{k}": ep[k] for k in ep})
    os.replace(W("best.tmp.npz"), W("best.npz"))
    lbtrain.save_adapter(W("best-adapter.npz"), lora, LCFG, BASE_SHA, step)


best = {"val": float("inf"), "step": 0, "stale": 0}
if os.path.exists(W("best.json")):
    best = json.load(open(W("best.json")))
slow = {"step": 0.0, "eval": 0.0, "evalSeconds": 0.0}
if step == 0:
    te = time.time()
    log({"step": 0, "val_loss": round(eval_loss(), 4)})
    slow["eval"] = time.time() - te
start = time.time()
run_start_step = step
last_save = start
last_saved = None  # (name, manifest sha256) of the newest save written by this run
last_val = None


def timed_save():
    global last_saved
    save()
    if last_saved and last_saved[0] == saves.save_name(step):
        return
    try:
        last_saved = saves.write_save(args.work, args.save_dir, step, cfg, DATA_SHA)
    except saves.SaveError as e:
        raise SystemExit(e.code)
    print(f"save step={step} name={last_saved[0]}", flush=True)


def stop_reason():
    if args.patience and best["stale"] >= args.patience:
        return "patience"
    if step >= cfg["total_steps"]:
        return "steps"
    if args.max_steps_this_run and step - run_start_step >= args.max_steps_this_run:
        return "max_steps_this_run"
    if time.time() - start >= args.max_seconds:
        return "max_seconds"
    if args.deadline:
        nxt = step + 1
        need = 2 * (slow["step"] + (slow["eval"] if nxt % args.eval_every == 0 or nxt == cfg["total_steps"] else 0.0))
        if time.time() + need >= args.deadline:
            return "deadline"
    return None


while (reason := stop_reason()) is None:
    if REPLAY:
        offs_r = rng.integers(0, len(replay_tok) - T - 1, k_replay) if k_replay else []
        offs_f = rng.integers(0, len(train_tok) - T - 1, B - k_replay) if B - k_replay else []
        rows = [replay_tok[o:o + T + 1] for o in offs_r] + [train_tok[o:o + T + 1] for o in offs_f]
        xy = np.stack(rows).astype(np.int64)
        x, y = xy[:, :T], xy[:, 1:]
    else:
        hi = lbtrain.curriculum_hi(step, CCFG, len(train_tok), T) if CCFG else len(train_tok)  # M158: easiest prefix
        offs = rng.integers(0, hi - T - 1, B)
        x = np.stack([train_tok[o:o + T] for o in offs]).astype(np.int64)
        y = np.stack([train_tok[o + 1:o + T + 1] for o in offs]).astype(np.int64)
    ts = time.time()
    fwd = lbtrain.compute_params(eval_params(), PREC)
    _, loss, cache = lm.forward(fwd, cfg, x, y, keep=True)
    if not lbtrain.loss_ok(loss):  # M159: a non-finite loss stops before its update is applied
        reason = "nonfinite"
        break
    grads = lm.backward(fwd, cfg, cache)
    del cache
    if LCFG:
        grads = lbtrain.lora_grads(grads, lora, LCFG, params)
    lr = lm.lr_at(step, cfg)
    try:
        gnorm = STEP_FN(trainable, grads, state, lr, cfg)
    except lbtrain.LbError as e:
        raise SystemExit(e.code)
    step += 1
    rec = {"step": step, "loss": round(loss, 4), "lr": round(lr, 7), "grad_norm": round(gnorm, 3), "sec": round(time.time() - ts, 2)}
    if REPLAY:
        rec["replay_rows"], rec["ft_rows"] = len(offs_r), len(offs_f)
    slow["step"] = max(slow["step"], time.time() - ts)
    if step % args.eval_every == 0 or step == cfg["total_steps"]:
        te = time.time()
        rec["val_loss"] = round(eval_loss(), 4)
        slow["eval"] = max(slow["eval"], time.time() - te)
        slow["evalSeconds"] += time.time() - te
        save()
        if args.keep_checkpoints:
            import shutil
            shutil.copyfile(W("checkpoint.npz"), W(f"ckpt-{step}.npz"))
        last_val = rec["val_loss"]
        if lbtrain.improved(rec["val_loss"], best["val"], args.min_delta):
            best = {"val": rec["val_loss"], "step": step, "stale": 0}
            import shutil
            if LCFG:
                save_best_merged()
            else:
                shutil.copyfile(W("checkpoint.npz"), W("best.npz"))
        else:
            best["stale"] += 1
        json.dump(best, open(W("best.json"), "w"))
    log(rec)
    if args.save_dir and saves.due(time.time(), last_save, args.save_every_min * 60.0):
        timed_save()
        last_save = time.time()
save()
if args.save_dir:
    timed_save()
if args.marker:
    nm, ms = last_saved if last_saved else (None, None)
    mk = saves.write_marker(args.marker, reason, step, cfg["total_steps"], nm, ms, cfg)
    print(f"marker more={'yes' if mk['more'] else 'no'} stop={reason} step={step}", flush=True)
with open(W("stop.json"), "w") as f:
    f.write(lbtrain.canonical(lbtrain.stop_record(reason, step, cfg["total_steps"], best, last_val, args.patience, args.min_delta,
                                                  args.max_seconds, time.time() - start)) + "\n")
json.dump({"setupSeconds": round(start - t0, 1), "trainSeconds": round(time.time() - start, 1), "evalSeconds": round(slow["evalSeconds"], 1),
           "steps": step - run_start_step, "stoppedStep": step, "bestStep": best["step"], "stopReason": reason,
           "timeCut": reason in ("max_seconds", "deadline")}, open(W("timing.json"), "w"), sort_keys=True)
print(f"best val_loss={best['val']} at step={best['step']}" + (" (early stop)" if args.patience and best["stale"] >= args.patience else ""), flush=True)
print(f"stopped step={step} of {cfg['total_steps']} elapsed={time.time() - t0:.0f}s", flush=True)
