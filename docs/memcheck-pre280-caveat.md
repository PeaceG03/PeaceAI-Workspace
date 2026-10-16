# Memcheck results before #280: caveat

Before #280 (merged as d29f6fc), `peaceai/bin/lm-memcheck.ts` built core prompts only from training-corpus docs whose
source is `PeaceG03/PeaceAI`. On a core-free corpus (every M49-style corpus) that gives **zero core prompts**, silently:
`memcheck.json` reported the requested prompt counts (96/32/8), not the prompts actually built, and empty-prompt samples
counted toward the 100-sample minimum.

**Any memcheck PASS recorded before #280 on a core-free corpus is NOT evidence of no core memorization.** Such a run never
prompted the model with core text, so it could not show whether the model reproduces core. Treat those PASS results as
unverified; only a post-#280 run (whose `memcheck.json` carries a `sampling` block with `builtPrompts.core` equal to the
requested count, `dropped: []`, and `scan.countedSamples` of at least 100) counts as evidence.

Example: run 38905982366 (model lm-v1-1bfbea221e71) built 0 of 96 core prompts and returned 80 samples (16 from empty
prompts); it failed only on the sample minimum.
