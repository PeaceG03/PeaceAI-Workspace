# TEST_CASE_EXISTING live proofs (drafts; file ONLY after #361 merges, the proposal issue is filed, and Peace posts /approve-rule)

Spec: public-test-case-existing-v1, sha256 81aba1e3e190ceff2e95c87b1faef43ed60bdb935bc11dfff290f2b8c32e3377 (PR #361).
Target: PeaceG03/PeaceSTOCKS at 47cfaaf. Issues are filed on PeaceAI-Workspace with the `[task]` title, the same way as earlier proofs.

## A (landing) - A-landing-isTenMinRangeOutageError.json
Box dry run (simulated approval): Job A wrote src/tenmin-range-reply-dust.outage-message-prefixes-11261d4.test.ts (create, selfGrade).
Local Job B: stub failure credited, permission model on, 32 module files read, verdict COUNTS.

## B (refusal) - B-refusal-easternSessionDate.json
Expected: no edit, refusal test_target_date_local (Intl / ET time zone).

## Remaining untested helpers (real tasks, file after approval; one issue each)
The analyzer accepts these 6 exported helpers at 47cfaaf, and no *.test.ts mentions them. A covers isTenMinRangeOutageError.
Each of the 5 tasks below builds in a box Job A dry run (simulated approval), and the generated tests pass on the real code (Node 22, 0 failures).
- tasks/dailyReplyDustHashedFileName.json -> src/daily-reply-dust.hashed-file-name-c770ecf.test.ts
- tasks/replyDustManifestKey.json -> src/intraday-reply-dust.manifest-key-per-session-d7f411f.test.ts
- tasks/dateFromDaysSinceEpoch.json -> src/tenmin-range-entries.utc-day-numbers-672f38a.test.ts
- tasks/tenMinRangePrefix.json -> src/tenmin-range-reply-dust.range-prefix-6e55c52.test.ts
- tasks/datedTickerPageFileName.json -> src/ticker-reference-dated.page-file-names-5d874df.test.ts
tenMinRangeGapReason and isTenMinRangeAbortError are already referenced by tenmin-range-entries.test.ts / oct2024-tenmin-oneoff.test.ts.
