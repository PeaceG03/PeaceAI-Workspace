"""LM retrain replay (forgetting fix, after run 40375535718): the pure rules train.py and the retrain scripts share.

No numpy, no model code, no I/O beyond what the caller passes in, so the unit tests pin each rule directly.
  replay_rows(batch, frac)      replay sequences per training batch: floor(batch * frac + 0.5); frac in [0, 1].
  val_windows(docs, ctx, n)     the early-stopping / step-selection windows: the first ctx+1 tokens of each heldout doc
                                (ascending doc id) that has at least ctx+1 tokens, ONE window per doc, the first n such
                                docs. Refuses (ValueError) when fewer than n docs qualify, so the windows always span n
                                distinct docs (the old rule cut 16 windows from one token stream: all in one doc).
  windows_sha(windows)          sha256 over "<doc>\\t<sha256 of the window's uint16 little-endian tokens>\\n".
  path_split(repo, path)        the fine-tune split by FILE PATH: heldout iff int(sha256("peaceai-ft-path:v1\\n" + repo +
                                "\\n" + path)[:8], 16) % 10 == 0, so every version of a file lands on the same side.
  significant_lines(text, n)    the stripped lines of at least n characters (the line-overlap rule's unit)."""
import hashlib
import math


def replay_rows(batch, frac):
    if isinstance(frac, bool) or not isinstance(frac, (int, float)) or not math.isfinite(frac) or not 0.0 <= frac <= 1.0:
        raise ValueError("replay frac must be a number in [0, 1]")
    if not isinstance(batch, int) or batch < 1:
        raise ValueError("batch must be a positive int")
    return int(math.floor(batch * frac + 0.5))


def val_windows(docs, ctx, n):
    """docs: iterable of (doc id, token list incl. the trailing EOD). Returns [(doc, tokens[0:ctx+1])]."""
    if n < 1:
        raise ValueError("val windows must be >= 1")
    out = []
    seen = set()
    for d, toks in sorted(docs, key=lambda x: x[0]):
        if d in seen:
            raise ValueError("val doc listed twice")
        seen.add(d)
        if len(toks) >= ctx + 1:
            out.append((d, list(toks[:ctx + 1])))
            if len(out) == n:
                return out
    raise ValueError(f"only {len(out)} heldout docs have {ctx + 1} tokens; {n} needed")


def windows_sha(windows):
    lines = []
    for d, toks in windows:
        lines.append(f"{d}\t{hashlib.sha256(b''.join(int(t).to_bytes(2, 'little') for t in toks)).hexdigest()}\n")
    return hashlib.sha256("".join(lines).encode("utf-8")).hexdigest()


def path_split(repo, path):
    h = hashlib.sha256(f"peaceai-ft-path:v1\n{repo}\n{path}".encode("utf-8")).hexdigest()
    return "heldout" if int(h[:8], 16) % 10 == 0 else "train"


def significant_lines(text, n):
    return {s for s in (l.strip() for l in text.split("\n")) if len(s) >= n}
