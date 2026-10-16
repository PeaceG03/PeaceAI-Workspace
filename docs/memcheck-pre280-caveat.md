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

## Sample id collision (found by the run 38911326479 provenance check)

`infer.py` gave both decodings of a prompt (greedy and sampled) the same `id` (the prompt id). Since #280 (d29f6fc),
`memcheck.json` `scan.unexplainedRuns` named runs by that shared id, so a run's sample was ambiguous.

**Scanning was not affected:** `scanSamples` (`peaceai/lib/lm.ts`) loops over the returned samples array
(`for (const s of samples)`), not over an id-keyed map, so every returned sample (both decodings) was scanned; the only
id-keyed lookup in the scan is `exempt.prompts.get(...)`, keyed by prompt id, which both decodings correctly share. The
collision only mislabeled runs; memcheck PASS results since #280 are not voided by it. The one consumer that did key
samples by id was `peaceai/bin/lm-provenance.ts` (#282, `byId`), which sliced runs from the wrong decoding, so the
provenance rows of run 38911326479 are not valid evidence.

Since this fix, sample ids are `<prompt id>:<decoding>` everywhere (infer output, memcheck records, provenance); a
duplicate id fails the memcheck and the provenance check closed; and `memcheck.json` records `scannedSamples`, which
must equal the returned count (else FAIL). Records made before it (e.g. memcheck run 38908186778) carry bare prompt ids
and are refused by the provenance check (`RECORD_IDS_AMBIGUOUS`) until a fresh memcheck is recorded.
